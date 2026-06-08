#!/bin/bash
# =============================================================================
# Mantle JS — Monorepo Scaffold Script
# =============================================================================
# Creates the full Nx monorepo for Mantle JS from scratch.
# Serves as the canonical setup documentation for the project.
#
# Prerequisites:
#   - Node.js v18 LTS or higher
#   - npm v9 or higher
#   - npx available on PATH
#   - Git configured with SSH access to GitHub
#
# Usage:
#   chmod +x scaffold.sh
#   ./scaffold.sh
#
# NOTE: Do NOT set CI=true when running this script locally.
# CI=true is reserved for GitHub Actions workflows — it causes several
# tools to treat warnings as hard errors and disables interactive fallbacks.
# =============================================================================

set -e           # Exit immediately on any error
set -u           # Treat unset variables as errors
set -o pipefail  # Catch errors in pipes

# Capture the directory the script is being run from so we can reference
# sibling files (PRD, TDD) regardless of where the user cd'd before running.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

WORKSPACE_NAME="mantle"
GIT_REMOTE="git@github.com:MantleJs/mantle.git"
NODE_MIN_VERSION=18

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

log() {
  echo ""
  echo "──────────────────────────────────────────────"
  echo "  $1"
  echo "──────────────────────────────────────────────"
}

# write <path>
# Creates parent directories as needed, then writes stdin to the file.
# Usage:
#   write "path/to/file" << 'EOF'
#   file content here
#   EOF
write() {
  mkdir -p "$(dirname "$1")"
  cat > "$1"
}

# -----------------------------------------------------------------------------
# Step 0: Check prerequisites
# -----------------------------------------------------------------------------

check_prerequisites() {
  log "Step 0: Checking prerequisites"

  if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed. Install Node.js v${NODE_MIN_VERSION} LTS or higher."
    exit 1
  fi

  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
    echo "ERROR: Node.js v${NODE_MIN_VERSION}+ required. Found: $(node -v)"
    exit 1
  fi

  if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is not installed."
    exit 1
  fi

  if ! command -v git &> /dev/null; then
    echo "ERROR: git is not installed."
    exit 1
  fi

  echo "✓ Node.js $(node -v)"
  echo "✓ npm $(npm -v)"
  echo "✓ git $(git --version)"
}

# -----------------------------------------------------------------------------
# Step 1: Create the Nx workspace
# -----------------------------------------------------------------------------

create_workspace() {
  log "Step 1: Creating Nx TypeScript workspace"

  npx create-nx-workspace@latest "$WORKSPACE_NAME" \
    --preset=ts \
    --packageManager=npm \
    --nxCloud=skip \
    --no-interactive

  echo "✓ Workspace created at ./${WORKSPACE_NAME}"
}

# -----------------------------------------------------------------------------
# Step 2: Align Nx package versions
# -----------------------------------------------------------------------------

align_nx_versions() {
  log "Step 2: Aligning Nx package versions"

  cd "$WORKSPACE_NAME"

  # create-nx-workspace can produce a workspace where @nx/* packages are at
  # mismatched versions (e.g. @nx/eslint@21.x while @nx/vitest@22.x). This
  # causes ERESOLVE errors the first time any npm install is attempted.
  #
  # Fix: read the installed nx core version and upgrade @nx/eslint to match.
  NX_VERSION=$(node -e "console.log(require('./node_modules/nx/package.json').version)")
  echo "  Detected nx version: $NX_VERSION"

  npm install --save-dev @nx/eslint@"$NX_VERSION"

  echo "✓ All @nx/* packages aligned to $NX_VERSION"
}

# -----------------------------------------------------------------------------
# Step 3: Create docs folder
# -----------------------------------------------------------------------------

create_docs() {
  log "Step 3: Creating docs folder"

  # Create docs/ at the workspace root to house project documentation.
  mkdir -p docs

  # Copy this scaffold script into docs/ for reference.
  cp "$SCRIPT_DIR/scaffold.sh" docs/scaffold.sh

  # Copy the PRD if it exists alongside this script; otherwise create a placeholder.
  if [ -f "$SCRIPT_DIR/mantle-js-prd.md" ]; then
    cp "$SCRIPT_DIR/mantle-js-prd.md" docs/mantle-js-prd.md
    echo "  ✓ PRD copied from $SCRIPT_DIR/mantle-js-prd.md"
  else
    cat > docs/mantle-js-prd.md << 'EOF'
# Mantle JS — Product Requirements Document

> Place `mantle-js-prd.md` here.
> Download it from the project documentation and replace this file.
EOF
    echo "  ⚠ PRD not found alongside script — placeholder created at docs/mantle-js-prd.md"
  fi

  # Copy the TDD if it exists alongside this script; otherwise create a placeholder.
  if [ -f "$SCRIPT_DIR/mantle-js-tdd.md" ]; then
    cp "$SCRIPT_DIR/mantle-js-tdd.md" docs/mantle-js-tdd.md
    echo "  ✓ TDD copied from $SCRIPT_DIR/mantle-js-tdd.md"
  else
    cat > docs/mantle-js-tdd.md << 'EOF'
# Mantle JS — Technical Design Document (Thin)

> Place `mantle-js-tdd.md` here.
> Download it from the project documentation and replace this file.
EOF
    echo "  ⚠ TDD not found alongside script — placeholder created at docs/mantle-js-tdd.md"
  fi

  echo "✓ docs/ folder created"
}

# -----------------------------------------------------------------------------
# Step 4: Generate Phase 1 packages
# -----------------------------------------------------------------------------

generate_packages() {
  log "Step 4: Generating Phase 1 packages"

  # Note: working directory is already set to the workspace by align_nx_versions.

  # Bundler: tsc
  #   Chosen over esbuild for Phase 1 because tsc emits .d.ts declaration files
  #   natively, which is critical for a TypeScript-first library. esbuild requires
  #   a separate tsc pass for declarations, adding complexity. Revisit in Phase 2.
  #
  # Test runner: vitest
  #   Faster than Jest, native ESM support, Jest-compatible API.
  #
  # Linter: eslint
  #   All packages share the root eslint.config.mjs.
  #
  # NX_DAEMON=false
  #   Required when running multiple nx g commands in a script. Without it, the
  #   Nx daemon started by the first generator conflicts with subsequent ones
  #   trying to spawn their own daemon process, causing a fatal plugin error.
  #   The daemon is only beneficial for interactive development; it adds no
  #   value during a one-shot scaffold run.

  # Stop any running Nx daemon before generating to avoid conflicts.
  npx nx daemon --stop 2>/dev/null || true

  # ---------------------------------------------------------------------------
  # @mantlejs/core — The framework kernel. Zero external runtime dependencies.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/core"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=core \
    --directory=packages/core \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/core \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/express — Express HTTP transport adapter.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/express"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=express \
    --directory=packages/express \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/express \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/postgresql — PostgreSQL adapter via Knex.js.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/postgresql"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=postgresql \
    --directory=packages/postgresql \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/postgresql \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/auth — Core authentication engine (JWT, strategy runner).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/auth"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=auth \
    --directory=packages/auth \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/auth \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/auth-local — Local (email + password) strategy.
  # Depends on @mantlejs/auth.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/auth-local"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=auth-local \
    --directory=packages/auth-local \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/auth-local \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/upload — File upload handling (multipart, local disk storage).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/upload"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=upload \
    --directory=packages/upload \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/upload \
    --no-interactive

  echo "✓ All packages generated"
}

# -----------------------------------------------------------------------------
# Step 5: Install runtime dependencies
# -----------------------------------------------------------------------------

install_dependencies() {
  log "Step 5: Installing runtime dependencies"

  # ---------------------------------------------------------------------------
  # @mantlejs/express — Express transport
  # ---------------------------------------------------------------------------
  echo "  → Express transport"
  npm install express
  npm install --save-dev @types/express

  # ---------------------------------------------------------------------------
  # @mantlejs/postgresql — Knex + pg driver
  # ---------------------------------------------------------------------------
  echo "  → PostgreSQL adapter"
  npm install knex pg
  npm install --save-dev @types/pg

  # ---------------------------------------------------------------------------
  # @mantlejs/auth — JWT engine
  # ---------------------------------------------------------------------------
  echo "  → Auth engine"
  npm install jsonwebtoken
  npm install --save-dev @types/jsonwebtoken

  # ---------------------------------------------------------------------------
  # @mantlejs/auth-local — Argon2id password hashing
  #
  # Using @node-rs/argon2 (Argon2id) instead of bcrypt because:
  #   - Argon2id is OWASP's recommended password hashing algorithm
  #   - Memory-hard: more resistant to GPU/ASIC brute-force attacks
  #   - No 72-character input limit (bcrypt silently truncates at 72 chars)
  #   - Ships prebuilt Rust-native binaries — no build step required on install
  # ---------------------------------------------------------------------------
  echo "  → Auth local strategy (Argon2id)"
  npm install @node-rs/argon2

  # ---------------------------------------------------------------------------
  # @mantlejs/upload — Multipart parsing
  # ---------------------------------------------------------------------------
  echo "  → Upload plugin"
  npm install busboy
  npm install --save-dev @types/busboy

  echo "✓ Runtime dependencies installed"
}

# -----------------------------------------------------------------------------
# Step 6: Configure Prettier
# -----------------------------------------------------------------------------

configure_linting() {
  log "Step 6: Configuring Prettier"

  # Nx already installs and configures ESLint with the following in the
  # workspace creation step (verified from generated root package.json):
  #   - eslint
  #   - @eslint/js
  #   - @nx/eslint + @nx/eslint-plugin  (incl. enforce-module-boundaries rule)
  #   - typescript-eslint               (unified TS parser + plugin package)
  #   - eslint-config-prettier
  #   - prettier
  #   - jsonc-eslint-parser
  #
  # Nx also generates:
  #   - root eslint.config.mjs          (do NOT overwrite — contains critical
  #                                      @nx/enforce-module-boundaries rule)
  #   - packages/*/eslint.config.mjs    (each extends root, adds
  #                                      @nx/dependency-checks for JSON)
  #
  # We only need to:
  #   1. Append our extra ignores to the Nx-generated .prettierignore
  #   2. Write .prettierrc (Nx does not generate this)

  # Nx already generates .prettierignore with:
  #   /dist, /coverage, /.nx/cache, /.nx/workspace-data
  cat >> .prettierignore << 'EOF'
/node_modules
*.min.js
EOF

  write ".prettierrc" << 'EOF'
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 120,
  "tabWidth": 2
}
EOF

  echo "✓ Prettier configured"

  # ---------------------------------------------------------------------------
  # NEXT STEP — Custom TypeScript ESLint rules
  # ---------------------------------------------------------------------------
  # To add project-specific lint rules (e.g. enforce double quotes, restrict
  # imports, ban certain patterns), edit the Nx-generated root eslint.config.mjs
  # after this scaffold runs. Add your rules inside the { files: ['**/*.ts'] }
  # block. Example:
  #
  #   {
  #     files: ['**/*.ts'],
  #     rules: {
  #       '@typescript-eslint/quotes': ['error', 'double'],
  #       '@typescript-eslint/no-explicit-any': 'warn',
  #       '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  #     },
  #   },
  #
  # Do NOT replace the full file — the @nx/enforce-module-boundaries rule and
  # the per-package @nx/dependency-checks rules must remain intact.
  # ---------------------------------------------------------------------------
}

# -----------------------------------------------------------------------------
# Step 7: Configure VS Code
# -----------------------------------------------------------------------------

configure_vscode() {
  log "Step 7: Configuring VS Code"

  # Editor settings — applied when opening the folder directly
  write ".vscode/settings.json" << 'EOF'
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.formatOnFocusChange": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "eslint.validate": ["typescript"],
  "eslint.workingDirectories": [{ "mode": "auto" }],
  "typescript.tsdk": "node_modules/typescript/lib"
}
EOF

  # Recommended extensions
  write ".vscode/extensions.json" << 'EOF'
{
  "recommendations": [
    // Linting & formatting
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    // Nx monorepo
    "nx-console.nx-console",
    // Testing
    "vitest.explorer",
    // Git
    "eamodio.gitlens",
    // TypeScript utilities
    "mattpocock.ts-error-translator"
  ]
}
EOF

  # Code workspace — use this file to open the project in VS Code.
  # Keeps workspace settings co-located with the repo.
  # Usage: code mantle.code-workspace
  write "mantle.code-workspace" << 'EOF'
{
  "folders": [
    { "path": "." }
  ],
  "settings": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true,
    "editor.formatOnFocusChange": true,
    "editor.codeActionsOnSave": {
      "source.fixAll.eslint": "explicit"
    },
    "eslint.validate": ["typescript"],
    "eslint.workingDirectories": [{ "mode": "auto" }],
    "typescript.tsdk": "node_modules/typescript/lib"
  }
}
EOF

  echo "✓ VS Code settings configured"
  echo "  Open project with: code mantle.code-workspace"
}

# -----------------------------------------------------------------------------
# Step 8: Create CLAUDE.md
# -----------------------------------------------------------------------------

create_claude_md() {
  log "Step 8: Creating CLAUDE.md"

  # CLAUDE.md lives at the workspace root. Claude Code reads it automatically
  # when the project is opened, providing architecture rules, key interfaces,
  # Nx commands, coding conventions, and enough context to generate correct
  # Mantle code without additional prompting.

  write "CLAUDE.md" << 'EOF'
# CLAUDE.md — Mantle JS

This file provides context for Claude Code to assist development on Mantle JS.
Read it fully before generating any code, adding packages, or modifying architecture.

---

## What is Mantle JS?

Mantle JS is a full-stack, tech-agnostic JavaScript/TypeScript framework for building
real-time applications and scalable web APIs. It follows Clean Architecture / Onion
Architecture principles, separating the service layer from data access logic.

The key differentiator from FeathersJS: in FeathersJS, a service couples business
logic directly with data access. In Mantle, `Service<T>` is a contract only —
data access lives in `Repository<T>` implementations in the Infrastructure layer.

**Name origin:** The Application Layer is the geological "mantle" — between the
database core and the UI crust.

---

## Architecture

### Layer Model

```
CRUST (UI)            React, Vue, Angular, iOS, Android
Transport Layer       Express adapter — routes HTTP to services
Application Layer     Service<T> contracts, hook pipeline   <- THE MANTLE
Domain Layer (Core)   Entities, Repository<T> interfaces
Infrastructure        KnexRepository — implements Domain interfaces (outer layer)
```

### Dependency Rule (non-negotiable)
- Dependencies always point inward
- Infrastructure implements interfaces defined by Domain — never the reverse
- Nothing in Domain or Application layers knows about HTTP or databases
- Phase 1: Application and Domain layers are co-located — full separation is opt-in

---

## Monorepo Structure

```
mantle/
├── packages/
│   ├── core/           @mantlejs/core        Framework kernel, zero external deps
│   ├── express/        @mantlejs/express     Express HTTP transport adapter
│   ├── postgresql/     @mantlejs/postgresql  PostgreSQL adapter via Knex.js
│   ├── auth/           @mantlejs/auth        JWT engine + strategy runner
│   ├── auth-local/     @mantlejs/auth-local  Local email+password strategy (Argon2id)
│   └── upload/         @mantlejs/upload      File upload via busboy, local disk storage
├── docs/               scaffold.sh, PRD, TDD
└── CLAUDE.md           This file
```

### Package Dependency Rules (enforced by @nx/enforce-module-boundaries)

| Package | May depend on |
|---|---|
| @mantlejs/core | nothing |
| @mantlejs/express | @mantlejs/core |
| @mantlejs/postgresql | @mantlejs/core |
| @mantlejs/auth | @mantlejs/core |
| @mantlejs/auth-local | @mantlejs/core, @mantlejs/auth |
| @mantlejs/upload | @mantlejs/core |

---

## Key Interfaces (all in @mantlejs/core)

### Service<T>
```typescript
interface Service<T, D = Partial<T>> {
  find(params?: ServiceParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ServiceParams): Promise<T>;
  create(data: D, params?: ServiceParams): Promise<T>;
  update(id: Id, data: D, params?: ServiceParams): Promise<T>;
  patch(id: Id, data: D, params?: ServiceParams): Promise<T>;
  remove(id: Id, params?: ServiceParams): Promise<T>;
}
```
Custom methods beyond these six must be explicitly registered in app.use() options.

### Repository<T>
```typescript
interface Repository<T, D = Partial<T>> {
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;
}
```

### HookContext<T>
```typescript
interface HookContext<T = any> {
  app: MantleApplication;
  service: Service<T>;
  path: string;        // e.g. "users"
  method: string;      // e.g. "create"
  provider?: string;   // "rest" | undefined (internal)
  params: ServiceParams;
  data?: Partial<T>;
  id?: Id;
  result?: T | T[] | Paginated<T>;
  error?: Error;
}
```

### HookFunction<T>
All hooks are pure functions — no class-based hooks.
```typescript
type HookFunction<T = any> =
  (context: HookContext<T>) => Promise<HookContext<T>> | HookContext<T>;
```

### Error Classes
Always throw a typed error — never a plain new Error().
```typescript
throw new BadRequest("Invalid input");        // 400
throw new NotAuthenticated("Login required"); // 401
throw new Forbidden("Access denied");         // 403
throw new NotFound("User not found");         // 404
throw new Conflict("Email already exists");   // 409
throw new Unprocessable("Validation failed"); // 422
throw new GeneralError("Something broke");    // 500
```

---

## Typical Usage Pattern

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { postgresql } from "@mantlejs/postgresql";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(postgresql({ connection: process.env.DATABASE_URL }))
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
});

app.service("users").hooks({
  before: {
    create: [hashPassword()],
    all: [authenticate("jwt")],
  },
  after: { all: [sanitizeUser()] },
  error: { all: [logError()] },
});

app.listen(3030);
```

---

## Nx Commands

```bash
npx nx build core                   # build one package
npx nx run-many -t build            # build all packages
npx nx test core                    # test one package
npx nx run-many -t test             # test all packages
npx nx run-many -t lint             # lint all packages
npx nx graph                        # visualise dependency graph

# Generate a new package (always use NX_DAEMON=false in scripts)
NX_DAEMON=false npx nx g @nx/js:library   --name=<name> --directory=packages/<name>   --bundler=tsc --unitTestRunner=vitest   --linter=eslint --publishable --importPath=@mantlejs/<name>
```

---

## Coding Conventions

| Convention | Rule |
|---|---|
| Quotes | Double quotes — enforced by Prettier |
| Semicolons | Required |
| Trailing commas | All |
| Print width | 120 characters |
| Hooks | Function-based only — no classes |
| Exports | Each package exports only from src/index.ts |
| Error handling | Always throw a typed MantleError subclass |
| any | Banned — use unknown and narrow |
| Test files | Co-located with source, *.spec.ts suffix |

---

## What Not to Do

- Do not add SSR, file-based routing, or frontend rendering — Mantle is API-only
- Do not couple a service to a concrete repository — depend on the interface
- Do not put HTTP-specific logic inside a service or hook
- Do not overwrite Nx-generated eslint.config.mjs — add rules additively
- Do not overwrite Nx-generated package.json fields (exports, files, nx, name)
- Do not use class-based hooks
- Do not throw plain Error — always use a typed MantleError subclass
- Do not import across packages in violation of the dependency matrix above

---

## Key Technology Decisions

| Decision | Choice | Reason |
|---|---|---|
| Monorepo | Nx (TS preset, npm) | Task pipeline, module boundary enforcement |
| DB adapter | Knex.js | Query builder not ORM — keeps infra layer thin |
| Password hashing | @node-rs/argon2 (Argon2id) | OWASP recommended; no 72-char bcrypt limit |
| Testing | Vitest | Faster than Jest, native ESM, Jest-compatible API |
| Transport (P1) | Express | Most familiar; AI-legible |
| Auth | auth + auth-local (two packages) | Engine separate from strategy |
| Bundler | tsc | Emits .d.ts natively — critical for TS-first libraries |
| Deployment | Google Cloud Run | Scales to zero; pairs with Cloud SQL |
EOF

  echo "✓ CLAUDE.md created"
}

# -----------------------------------------------------------------------------
# Step 9: Patch individual package metadata
# -----------------------------------------------------------------------------

configure_packages() {
  log "Step 9: Patching package metadata and peer dependencies"

  # IMPORTANT: Nx generates package.json files with critical fields we must
  # preserve:
  #   - "type": "module"           ESM module declaration
  #   - "exports"                  Full exports map incl. @mantle/source condition
  #   - "files"                    Controls what gets published to npm
  #   - "nx": { "name": ... }      Nx internal project identifier
  #   - "dependencies": { tslib }  Runtime dependency added by Nx
  #   - "name"                     Already set correctly via --importPath flag
  #
  # Strategy: READ -> PATCH specific fields only -> WRITE.
  # Uses single-quoted Node.js heredocs (<< 'NODEJS') so no bash interpolation
  # occurs inside the JS -- avoids all quoting and newline escaping issues.

  # @mantlejs/core
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/core/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'The Mantle JS framework kernel';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'api', 'framework', 'typescript'];
pkg.peerDependencies = { ...(pkg.peerDependencies || {}) };
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/express
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/express/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Express transport adapter for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'express', 'rest', 'api'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/core': '^0.1.0',
  'express': '^4.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/postgresql
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/postgresql/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'PostgreSQL adapter for Mantle JS via Knex.js';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'postgresql', 'knex', 'database'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/core': '^0.1.0',
  'knex': '^3.0.0',
  'pg': '^8.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/auth
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/auth/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Core authentication engine for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'auth', 'jwt', 'authentication'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/core': '^0.1.0',
  'jsonwebtoken': '^9.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/auth-local
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/auth-local/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Local (email + password) authentication strategy for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'auth', 'local', 'password', 'argon2'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/core': '^0.1.0',
  '@mantlejs/auth': '^0.1.0',
  '@node-rs/argon2': '^2.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/upload
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/upload/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'File upload handling plugin for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'upload', 'multipart', 'busboy'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/core': '^0.1.0',
  'busboy': '^1.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  echo "✓ Package metadata patched"
}

# -----------------------------------------------------------------------------
# Step 10: Connect to the Git remote
# -----------------------------------------------------------------------------

setup_git() {
  log "Step 10: Connecting to Git remote"

  # Nx initialises git and makes an initial commit during workspace creation.
  # If for any reason that did not happen, initialise and commit now.
  if [ ! -d ".git" ]; then
    git init
    git add -A
    git commit -m "chore: initial scaffold"
  fi

  git remote add origin "$GIT_REMOTE"

  # Fetch the remote (which contains a placeholder README on main).
  git fetch origin

  # Rename local branch to main to match the remote convention.
  git branch -M main

  # Git 2.33+ requires an explicit reconciliation strategy when branches
  # diverge (no common ancestor). Set merge mode so Git does not abort
  # with "need to specify how to reconcile divergent branches".
  git config pull.rebase false

  # Merge the remote placeholder README into our local scaffold.
  # --allow-unrelated-histories is required because the remote commit
  # and the Nx initial commit share no common ancestor.
  git pull origin main --allow-unrelated-histories --no-edit

  # Stage and commit any changes that came in from the remote.
  if ! git diff --cached --quiet 2>/dev/null || ! git diff --quiet 2>/dev/null; then
    git add -A
    git commit -m "chore: merge remote placeholder into scaffold"
  fi

  # Push and set the upstream tracking branch.
  git push -u origin main

  echo "✓ Git remote connected: $GIT_REMOTE"
}

# -----------------------------------------------------------------------------
# Step 11: Smoke test
# -----------------------------------------------------------------------------

smoke_test() {
  log "Step 11: Smoke test — building @mantlejs/core"

  npx nx build core

  echo "✓ @mantlejs/core builds successfully"
}

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------

print_summary() {
  log "Scaffold complete"

  echo ""
  echo "  Workspace:  ${WORKSPACE_NAME}/"
  echo ""
  echo "  Packages:"
  echo "    packages/core         → @mantlejs/core"
  echo "    packages/express      → @mantlejs/express"
  echo "    packages/postgresql   → @mantlejs/postgresql"
  echo "    packages/auth         → @mantlejs/auth"
  echo "    packages/auth-local   → @mantlejs/auth-local"
  echo "    packages/upload       → @mantlejs/upload"
  echo ""
  echo "  Open in VS Code:"
  echo "    code ${WORKSPACE_NAME}/mantle.code-workspace"
  echo ""
  echo "  Useful Nx commands:"
  echo "    npx nx graph                  # visualise the project graph"
  echo "    npx nx build core             # build a single package"
  echo "    npx nx run-many -t build      # build all packages"
  echo "    npx nx run-many -t test       # run all tests"
  echo "    npx nx run-many -t lint       # lint all packages"
  echo ""
  echo "  NOTE: Set CI=true only in GitHub Actions workflows, not locally."
  echo ""
}

# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------

main() {
  check_prerequisites
  create_workspace
  align_nx_versions
  create_docs
  generate_packages
  install_dependencies
  configure_linting
  configure_vscode
  create_claude_md
  configure_packages
  setup_git
  smoke_test
  print_summary
}

main