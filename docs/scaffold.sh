#!/bin/bash
# =============================================================================
# Mantle JS — Monorepo Scaffold Script
# =============================================================================
# Creates the full Nx monorepo for Mantle JS from scratch, matching the
# current state of the project (Phases 1-3 packages; Phase 4 client/react
# packages are not yet generated in the real repo and are intentionally
# absent here too — add them here once they exist under packages/).
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
# Step 4: Generate packages
# -----------------------------------------------------------------------------

generate_packages() {
  log "Step 4: Generating packages"

  # Note: working directory is already set to the workspace by align_nx_versions.

  # Bundler: tsc
  #   Emits .d.ts declaration files natively, critical for TypeScript-first
  #   libraries. esbuild would require a separate tsc pass for declarations.
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
  #
  # Generation order follows the dependency graph (a package's dependencies
  # are generated before the package itself) so that peerDependencies patched
  # in Step 9 always reference an already-existing workspace package.

  # Stop any running Nx daemon before generating to avoid conflicts.
  npx nx daemon --stop 2>/dev/null || true

  # ---------------------------------------------------------------------------
  # @mantlejs/mantle — The framework kernel. Zero external runtime dependencies.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/mantle"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=mantle \
    --directory=packages/mantle \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/mantle \
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
  # @mantlejs/koa — Koa HTTP transport adapter.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/koa"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=koa \
    --directory=packages/koa \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/koa \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/http — Zero-dependency HTTP transport adapter (Node.js handler +
  # Fetch API handler, for edge/serverless runtimes with no framework).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/http"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=http \
    --directory=packages/http \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/http \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/knex — SQL adapter via Knex.js (PostgreSQL, MySQL, SQLite, MSSQL).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/knex"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=knex \
    --directory=packages/knex \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/knex \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/dynamodb — Amazon DynamoDB adapter (AWS SDK v3).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/dynamodb"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=dynamodb \
    --directory=packages/dynamodb \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/dynamodb \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/supabase — Supabase adapter (Postgres + Realtime).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/supabase"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=supabase \
    --directory=packages/supabase \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/supabase \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/pinecone — Pinecone vector database adapter.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/pinecone"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=pinecone \
    --directory=packages/pinecone \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/pinecone \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/qdrant — Qdrant vector database adapter.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/qdrant"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=qdrant \
    --directory=packages/qdrant \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/qdrant \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/neo4j — Neo4j graph database adapter.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/neo4j"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=neo4j \
    --directory=packages/neo4j \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/neo4j \
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
  # @mantlejs/auth-oauth — Shared OAuth 2.0 base (state, PKCE, find-or-create).
  # Depends on @mantlejs/auth.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/auth-oauth"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=auth-oauth \
    --directory=packages/auth-oauth \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/auth-oauth \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/auth-google — Google Sign-In strategy (PKCE, no Passport.js).
  # Depends on @mantlejs/auth-oauth.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/auth-google"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=auth-google \
    --directory=packages/auth-google \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/auth-google \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/auth-github — GitHub Sign-In strategy (no Passport.js).
  # Depends on @mantlejs/auth-oauth.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/auth-github"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=auth-github \
    --directory=packages/auth-github \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/auth-github \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/auth-facebook — Facebook Sign-In strategy (no Passport.js).
  # Depends on @mantlejs/auth-oauth.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/auth-facebook"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=auth-facebook \
    --directory=packages/auth-facebook \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/auth-facebook \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/storage — File upload/download handling (multipart, local disk).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/storage"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=storage \
    --directory=packages/storage \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/storage \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/storage-s3 — AWS S3 storage adapter for @mantlejs/storage.
  # Depends on @mantlejs/storage.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/storage-s3"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=storage-s3 \
    --directory=packages/storage-s3 \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/storage-s3 \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/storage-gcs — Google Cloud Storage adapter for @mantlejs/storage.
  # Depends on @mantlejs/storage.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/storage-gcs"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=storage-gcs \
    --directory=packages/storage-gcs \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/storage-gcs \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/logger — Structured logging (pino adapter, request/error hooks).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/logger"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=logger \
    --directory=packages/logger \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/logger \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/schema — TypeBox schema validation and field resolution hooks.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/schema"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=schema \
    --directory=packages/schema \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/schema \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/memory — In-memory Repository<T> for testing and prototyping.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/memory"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=memory \
    --directory=packages/memory \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/memory \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/config — Environment-aware configuration loading.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/config"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=config \
    --directory=packages/config \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/config \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/socketio — Socket.IO transport adapter.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/socketio"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=socketio \
    --directory=packages/socketio \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/socketio \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/sync — Cross-instance event sync (Redis or Supabase Realtime).
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/sync"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=sync \
    --directory=packages/sync \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/sync \
    --no-interactive

  # ---------------------------------------------------------------------------
  # @mantlejs/cli — Command-line interface (scaffold projects/services/hooks).
  # Standalone code generator — no @mantlejs/* peer dependency.
  # ---------------------------------------------------------------------------
  echo "  → Generating @mantlejs/cli"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=cli \
    --directory=packages/cli \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=@mantlejs/cli \
    --no-interactive

  # ---------------------------------------------------------------------------
  # create-mantle — `npm create mantle` entry point. Unscoped package name
  # (npm's `create` convention requires this) that delegates to @mantlejs/cli.
  # Depends on @mantlejs/cli.
  # ---------------------------------------------------------------------------
  echo "  → Generating create-mantle"
  NX_DAEMON=false npx nx g @nx/js:library \
    --name=create-mantle \
    --directory=packages/create-mantle \
    --bundler=tsc \
    --unitTestRunner=vitest \
    --linter=eslint \
    --publishable \
    --importPath=create-mantle \
    --no-interactive

  echo "✓ All packages generated"
}

# -----------------------------------------------------------------------------
# Step 5: Install runtime dependencies
# -----------------------------------------------------------------------------
#
# Convention: third-party libraries that an adapter/transport package only
# *peer*-depends on (the contract "the host app must provide this") are
# installed once at the workspace root, acting as the "host app" for local
# development. Libraries a package bundles as its own real dependency
# (e.g. @mantlejs/cli's commander/prompts, @mantlejs/schema's ajv) are
# installed directly into that package via `--workspace=<name>` instead.

install_dependencies() {
  log "Step 5: Installing runtime dependencies"

  # ---------------------------------------------------------------------------
  # @mantlejs/express — Express transport (peer: express@^5)
  # ---------------------------------------------------------------------------
  echo "  → Express transport"
  npm install "express@^5"
  npm install --save-dev @types/express

  # ---------------------------------------------------------------------------
  # @mantlejs/koa — Koa transport (peer: koa@^3, @koa/router@^15, @koa/bodyparser@^6)
  # ---------------------------------------------------------------------------
  echo "  → Koa transport"
  npm install "koa@^3" "@koa/router@^15" "@koa/bodyparser@^6"
  npm install --save-dev @types/koa @types/koa__router

  # ---------------------------------------------------------------------------
  # @mantlejs/http — zero-dependency transport, no runtime libraries required.
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # @mantlejs/knex — Knex.js + PostgreSQL driver (primary supported database)
  # ---------------------------------------------------------------------------
  echo "  → Knex SQL adapter"
  npm install "knex@^3" pg
  npm install --save-dev @types/pg

  # ---------------------------------------------------------------------------
  # @mantlejs/dynamodb — AWS SDK v3 DynamoDB clients
  # ---------------------------------------------------------------------------
  echo "  → DynamoDB adapter"
  npm install "@aws-sdk/client-dynamodb@^3" "@aws-sdk/util-dynamodb@^3"

  # ---------------------------------------------------------------------------
  # @mantlejs/supabase — Supabase JS client
  # ---------------------------------------------------------------------------
  echo "  → Supabase adapter"
  npm install "@supabase/supabase-js@^2"

  # ---------------------------------------------------------------------------
  # @mantlejs/pinecone — Pinecone client
  # ---------------------------------------------------------------------------
  echo "  → Pinecone adapter"
  npm install "@pinecone-database/pinecone@^5"

  # ---------------------------------------------------------------------------
  # @mantlejs/qdrant — Qdrant REST client
  # ---------------------------------------------------------------------------
  echo "  → Qdrant adapter"
  npm install "@qdrant/js-client-rest@^1"

  # ---------------------------------------------------------------------------
  # @mantlejs/neo4j — Neo4j driver
  # ---------------------------------------------------------------------------
  echo "  → Neo4j adapter"
  npm install "neo4j-driver@^5"

  # ---------------------------------------------------------------------------
  # @mantlejs/auth — JWT engine
  # ---------------------------------------------------------------------------
  echo "  → Auth engine"
  npm install "jsonwebtoken@^9"
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
  npm install "@node-rs/argon2@^2"

  # ---------------------------------------------------------------------------
  # @mantlejs/auth-oauth, auth-google, auth-github, auth-facebook — no runtime
  # libraries required. PKCE/state/authorization-code flows are implemented
  # directly against `fetch`, deliberately avoiding Passport.js.
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # @mantlejs/storage — Multipart parsing
  # ---------------------------------------------------------------------------
  echo "  → Storage plugin"
  npm install "busboy@^1"
  npm install --save-dev @types/busboy

  # ---------------------------------------------------------------------------
  # @mantlejs/storage-s3 — AWS SDK v3 S3 client + multipart upload helper
  # ---------------------------------------------------------------------------
  echo "  → S3 storage adapter"
  npm install "@aws-sdk/client-s3@^3" "@aws-sdk/lib-storage@^3"

  # ---------------------------------------------------------------------------
  # @mantlejs/storage-gcs — Google Cloud Storage client
  # ---------------------------------------------------------------------------
  echo "  → GCS storage adapter"
  npm install "@google-cloud/storage@^7"

  # ---------------------------------------------------------------------------
  # @mantlejs/logger — pino structured logger
  # ---------------------------------------------------------------------------
  echo "  → Logger plugin"
  npm install "pino@^9"

  # ---------------------------------------------------------------------------
  # @mantlejs/schema — bundles its own validation stack (TypeBox + Ajv), not a
  # peer dependency of the host app, so it installs into the package itself.
  # ---------------------------------------------------------------------------
  echo "  → Schema plugin (bundled deps)"
  npm install "@sinclair/typebox@^0.34" ajv ajv-formats --workspace=@mantlejs/schema

  # ---------------------------------------------------------------------------
  # @mantlejs/memory — no runtime libraries required.
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # @mantlejs/config — peer-depends on TypeBox (schemas authored by the host
  # app), but bundles Ajv itself for validation.
  # ---------------------------------------------------------------------------
  echo "  → Config plugin"
  npm install "@sinclair/typebox@^0.34"
  npm install ajv --workspace=@mantlejs/config

  # ---------------------------------------------------------------------------
  # @mantlejs/socketio — bundles socket.io itself (the transport IS the
  # dependency, not something the host app separately provides).
  # ---------------------------------------------------------------------------
  echo "  → Socket.IO transport (bundled dep)"
  npm install socket.io --workspace=@mantlejs/socketio

  # ---------------------------------------------------------------------------
  # @mantlejs/sync — ioredis client (Redis/DragonflyDB pub-sub adapter)
  # ---------------------------------------------------------------------------
  echo "  → Sync plugin"
  npm install "ioredis@^5"

  # ---------------------------------------------------------------------------
  # @mantlejs/cli — bundles its own runtime deps (it is a standalone
  # executable, not a library consumed by a host app).
  # ---------------------------------------------------------------------------
  echo "  → CLI (bundled deps)"
  npm install commander prompts typescript prettier --workspace=@mantlejs/cli
  npm install --save-dev @types/prompts --workspace=@mantlejs/cli

  # ---------------------------------------------------------------------------
  # create-mantle — depends only on the (already workspace-linked)
  # @mantlejs/cli package. No external install needed.
  # ---------------------------------------------------------------------------

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
  #
  # This is a point-in-time snapshot of the project's actual root CLAUDE.md.
  # Keep it in sync manually when the real CLAUDE.md changes meaningfully
  # (new packages, new architectural rules) — there is no automated sync.

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
│   ├── mantle/          @mantlejs/mantle       Framework kernel, zero external deps
│   ├── express/         @mantlejs/express      Express HTTP transport adapter
│   ├── koa/             @mantlejs/koa          Koa HTTP transport adapter
│   ├── http/            @mantlejs/http         Zero-dependency HTTP transport adapter (Node + Fetch API)
│   ├── knex/            @mantlejs/knex         SQL adapter via Knex.js (pg, mysql2, sqlite3…)
│   ├── dynamodb/        @mantlejs/dynamodb     Amazon DynamoDB adapter
│   ├── supabase/        @mantlejs/supabase     Supabase adapter (Postgres + Realtime)
│   ├── pinecone/        @mantlejs/pinecone     Pinecone vector database adapter
│   ├── qdrant/          @mantlejs/qdrant       Qdrant vector database adapter
│   ├── neo4j/           @mantlejs/neo4j        Neo4j graph database adapter
│   ├── auth/            @mantlejs/auth         JWT engine + strategy runner
│   ├── auth-local/      @mantlejs/auth-local   Local email+password strategy (Argon2id)
│   ├── auth-oauth/      @mantlejs/auth-oauth   Shared OAuth 2.0 base (state, PKCE, find-or-create)
│   ├── auth-google/     @mantlejs/auth-google  Google Sign-In strategy (PKCE, no Passport.js)
│   ├── auth-github/     @mantlejs/auth-github  GitHub Sign-In strategy (no Passport.js)
│   ├── auth-facebook/   @mantlejs/auth-facebook Facebook Sign-In strategy (no Passport.js)
│   ├── storage/         @mantlejs/storage      File upload/download via busboy, local disk storage
│   ├── storage-s3/      @mantlejs/storage-s3   AWS S3 storage adapter for @mantlejs/storage
│   ├── storage-gcs/     @mantlejs/storage-gcs  Google Cloud Storage adapter for @mantlejs/storage
│   ├── logger/          @mantlejs/logger       Structured logging (pino)
│   ├── schema/          @mantlejs/schema       TypeBox schema validation + field resolution
│   ├── memory/          @mantlejs/memory       In-memory Repository<T> for testing/prototyping
│   ├── config/          @mantlejs/config       Environment-aware configuration loading
│   ├── socketio/        @mantlejs/socketio     Socket.IO transport adapter
│   ├── sync/            @mantlejs/sync         Cross-instance event sync (Redis/Supabase Realtime)
│   ├── cli/             @mantlejs/cli          Command-line interface — scaffold projects/services/hooks
│   └── create-mantle/   create-mantle          `npm create mantle` project initializer
├── docs/               scaffold.sh, PRD, TDD
└── CLAUDE.md           This file
```

### Package Dependency Rules (enforced by @nx/enforce-module-boundaries)

| Package                | May depend on                                |
| ---------------------- | --------------------------------------------- |
| @mantlejs/mantle        | nothing                                       |
| @mantlejs/express       | @mantlejs/mantle                              |
| @mantlejs/koa           | @mantlejs/mantle                              |
| @mantlejs/http          | @mantlejs/mantle                              |
| @mantlejs/knex          | @mantlejs/mantle                              |
| @mantlejs/dynamodb      | @mantlejs/mantle                              |
| @mantlejs/supabase      | @mantlejs/mantle                              |
| @mantlejs/pinecone      | @mantlejs/mantle                              |
| @mantlejs/qdrant        | @mantlejs/mantle                              |
| @mantlejs/neo4j         | @mantlejs/mantle                              |
| @mantlejs/auth          | @mantlejs/mantle                              |
| @mantlejs/auth-local    | @mantlejs/mantle, @mantlejs/auth              |
| @mantlejs/auth-oauth    | @mantlejs/mantle, @mantlejs/auth              |
| @mantlejs/auth-google   | @mantlejs/mantle, @mantlejs/auth-oauth        |
| @mantlejs/auth-github   | @mantlejs/mantle, @mantlejs/auth-oauth        |
| @mantlejs/auth-facebook | @mantlejs/mantle, @mantlejs/auth-oauth        |
| @mantlejs/storage       | @mantlejs/mantle                              |
| @mantlejs/storage-s3    | @mantlejs/mantle, @mantlejs/storage           |
| @mantlejs/storage-gcs   | @mantlejs/mantle, @mantlejs/storage           |
| @mantlejs/logger        | @mantlejs/mantle                              |
| @mantlejs/schema        | @mantlejs/mantle                              |
| @mantlejs/memory        | @mantlejs/mantle                              |
| @mantlejs/config        | @mantlejs/mantle                              |
| @mantlejs/socketio      | @mantlejs/mantle                              |
| @mantlejs/sync          | @mantlejs/mantle                              |
| @mantlejs/cli           | nothing (standalone code generator)           |
| create-mantle           | @mantlejs/cli                                 |

---

## Key Interfaces (all in @mantlejs/mantle)

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

### QueryParams — supported where operators

```typescript
interface QueryParams {
  where?: Record<string, unknown>; // see operators below
  limit?: number;
  skip?: number;
  sort?: Record<string, "asc" | "desc">;
  select?: string[];
}
```

Operators supported in `where`:

- Equality: `{ field: value }` → `field = value`
- Null: `{ field: null }` → `IS NULL`
- Comparison: `$lt`, `$lte`, `$gt`, `$gte`
- Not-equal: `{ field: { $ne: value } }` (value `null` → `IS NOT NULL`)
- Inclusion: `$in`, `$nin`
- Logical: `$or`, `$and` (accept arrays of where clauses)
- Pattern: `$like`, `$notlike`, `$ilike` (PostgreSQL only)

### HookContext<T>

```typescript
interface HookContext<T = any> {
  app: MantleApplication;
  service: Service<T>;
  path: string; // e.g. "users"
  method: string; // e.g. "create"
  provider?: string; // "rest" | undefined (internal)
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
type HookFunction<T = any> = (context: HookContext<T>) => Promise<HookContext<T>> | HookContext<T>;
```

### Error Classes

Always throw a typed error — never a plain new Error().

```typescript
throw new BadRequest("Invalid input"); // 400
throw new NotAuthenticated("Login required"); // 401
throw new Forbidden("Access denied"); // 403
throw new NotFound("User not found"); // 404
throw new Conflict("Email already exists"); // 409
throw new Unprocessable("Validation failed"); // 422
throw new GeneralError("Something broke"); // 500
```

---

## Typical Usage Pattern

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { knex } from "@mantlejs/knex";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }))
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

### KnexRepository usage

```typescript
import { KnexRepository } from "@mantlejs/knex";

class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";

  // Custom query using the raw query builder
  async findByEmail(email: string): Promise<User | null> {
    return this.db.where({ email }).first() ?? null;
  }
}

// Transaction example
const repo = new UserRepository(app);
await repo.withTransaction(async (txRepo) => {
  const user = await txRepo.save({ name: "Alice", email: "alice@example.com" });
  await txRepo.save({ userId: user.id, role: "admin" }); // hypothetical
});
```

---

## Nx Commands

```bash
npx nx build mantle                 # build one package
npx nx run-many -t build            # build all packages
npx nx test mantle                  # test one package
npx nx run-many -t test             # test all packages
npx nx run-many -t lint             # lint all packages
npx nx graph                        # visualise dependency graph

# Generate a new package (always use NX_DAEMON=false in scripts)
NX_DAEMON=false npx nx g @nx/js:library   --name=<name> --directory=packages/<name>   --bundler=tsc --unitTestRunner=vitest   --linter=eslint --publishable --importPath=@mantlejs/<name>
```

---

## Coding Conventions

| Convention      | Rule                                        |
| --------------- | -------------------------------------------- |
| Quotes          | Double quotes — enforced by Prettier        |
| Semicolons      | Required                                    |
| Trailing commas | All                                         |
| Print width     | 120 characters                              |
| Hooks           | Function-based only — no classes            |
| Exports         | Each package exports only from src/index.ts |
| Error handling  | Always throw a typed MantleError subclass   |
| any             | Banned — use unknown and narrow             |
| Test files      | Co-located with source, \*.spec.ts suffix   |

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

| Decision                | Choice                                             | Reason                                                       |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| Monorepo                | Nx (TS preset, npm)                                | Task pipeline, module boundary enforcement                   |
| DB adapter              | @mantlejs/knex via Knex.js                         | Single package for all SQL databases; query builder not ORM  |
| Supported SQL databases | PostgreSQL (primary), MySQL/MariaDB, SQLite, MSSQL | Knex abstracts differences; `RETURNING *` fallback for MySQL |
| Password hashing        | @node-rs/argon2 (Argon2id)                         | OWASP recommended; no 72-char bcrypt limit                   |
| Testing                 | Vitest                                             | Faster than Jest, native ESM, Jest-compatible API             |
| Transport (P1)          | Express                                            | Most familiar; AI-legible                                    |
| Auth                    | auth + auth-local (two packages)                   | Engine separate from strategy                                |
| Bundler                 | tsc                                                | Emits .d.ts natively — critical for TS-first libraries        |
| Deployment              | Google Cloud Run                                   | Scales to zero; pairs with Cloud SQL                          |

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Docs

- `docs/planning/` — PRDs, TDDs, phase checklists
- `docs/decisions/` — ADRs and design rationale; follow `adr-001-*.md` as the naming and format template

## FeathersJS comparisons

When the user asks to compare a Mantle package or feature with FeathersJS, ALWAYS write the comparison to a markdown file in `docs/decisions/` (e.g. `docs/decisions/socketio-comparison.md`, `docs/decisions/auth-comparison.md`) in addition to any inline response. Use the existing files in `docs/decisions/` as format reference.

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools
- After generating a new package, ALWAYS replace the Nx-generated `README.md` with a full package README following the template in `packages/auth/README.md`. Sections: package name + one-line description, Installation, Concepts, Quick start, API (with options table), Types, Development, Publishing.
- After generating a new package, ALWAYS add it to the Packages table in the root `README.md`.

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax
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

  # @mantlejs/mantle
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/mantle/package.json';
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
  '@mantlejs/mantle': '^0.1.0',
  'express': '^5.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/koa
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/koa/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Koa HTTP transport adapter for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'koa', 'rest', 'api'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  'koa': '^3.0.0',
  '@koa/router': '^15.0.0',
  '@koa/bodyparser': '^6.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/http
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/http/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Zero-dependency HTTP transport adapter for Mantle JS (Node.js handler + Fetch API handler)';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'http', 'transport', 'edge', 'cloudflare-workers'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/knex
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/knex/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'SQL database adapter for Mantle JS via Knex.js (PostgreSQL, MySQL, SQLite, MSSQL)';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'knex', 'sql', 'postgresql', 'mysql', 'sqlite', 'database'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.1.0',
  'knex': '^3.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/dynamodb
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/dynamodb/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Amazon DynamoDB adapter for Mantle JS — DynamoDbRepository with full QueryParams support';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'dynamodb', 'aws', 'nosql', 'database', 'repository'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.1.0',
  '@aws-sdk/client-dynamodb': '^3.0.0',
  '@aws-sdk/util-dynamodb': '^3.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/supabase
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/supabase/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Supabase adapter for Mantle JS — SupabaseRepository with full QueryParams support';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'supabase', 'postgresql', 'database', 'repository'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@supabase/supabase-js': '^2.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/pinecone
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/pinecone/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Pinecone vector database adapter for Mantle JS — PineconeRepository with full QueryParams support';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'pinecone', 'vector', 'database', 'repository'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@pinecone-database/pinecone': '^5.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/qdrant
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/qdrant/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Qdrant vector database adapter for Mantle JS — QdrantRepository with full QueryParams support';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'qdrant', 'vector', 'database', 'repository'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@qdrant/js-client-rest': '^1.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/neo4j
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/neo4j/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Neo4j graph database adapter for Mantle JS — Neo4jRepository with full QueryParams support';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'neo4j', 'graph', 'database', 'repository'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  'neo4j-driver': '^5.0.0',
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
  '@mantlejs/mantle': '^0.0.1',
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
  '@mantlejs/mantle': '^0.0.1',
  '@mantlejs/auth': '^0.0.1',
  '@node-rs/argon2': '^2.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/auth-oauth
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/auth-oauth/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Shared OAuth 2.0 base for Mantle JS auth strategies';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'auth', 'oauth', 'oauth2'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@mantlejs/auth': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/auth-google
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/auth-google/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Google OAuth 2.0 strategy for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'auth', 'google', 'oauth2'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@mantlejs/auth-oauth': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/auth-github
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/auth-github/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'GitHub OAuth 2.0 strategy for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'auth', 'github', 'oauth2'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@mantlejs/auth-oauth': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/auth-facebook
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/auth-facebook/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Facebook OAuth 2.0 strategy for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'auth', 'facebook', 'oauth2'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@mantlejs/auth-oauth': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/storage
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/storage/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'File upload/download storage plugin for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'storage', 'upload', 'multipart', 'busboy'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.1.0',
  'busboy': '^1.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/storage-s3
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/storage-s3/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'AWS S3 storage adapter for @mantlejs/storage';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'storage', 'upload', 's3', 'aws'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/storage': '^0.0.1',
  '@aws-sdk/client-s3': '^3.0.0',
  '@aws-sdk/lib-storage': '^3.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/storage-gcs
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/storage-gcs/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Google Cloud Storage adapter for @mantlejs/storage';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'storage', 'upload', 'gcs', 'google-cloud'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/storage': '^0.0.1',
  '@google-cloud/storage': '^7.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/logger
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/logger/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Structured logging plugin for Mantle JS — pino adapter and request/error hook factories';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'logger', 'pino', 'logging'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  'pino': '^9.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/schema
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/schema/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'TypeBox schema definition, Ajv validation, and data resolution for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'schema', 'typebox', 'validation', 'resolver'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/memory
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/memory/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'In-memory Repository<T> implementation for testing and prototyping with Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'memory', 'repository', 'testing'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/config
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/config/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Environment-aware configuration loading with optional schema validation for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'config', 'configuration', 'typescript'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  '@sinclair/typebox': '^0.34.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/socketio
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/socketio/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Socket.IO transport adapter for Mantle JS';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'socketio', 'websocket', 'realtime'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/sync
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/sync/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Cross-instance event sync for Mantle JS — broadcasts service events across multiple application instances via Redis or Supabase Realtime';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'sync', 'realtime', 'redis', 'pubsub', 'events', 'typescript'];
pkg.peerDependencies = {
  ...(pkg.peerDependencies || {}),
  '@mantlejs/mantle': '^0.0.1',
  'ioredis': '^5.0.0',
};
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # @mantlejs/cli
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/cli/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Command-line interface for Mantle JS — scaffold projects, services, repositories, and hooks';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'cli', 'scaffolding', 'codegen', 'typescript'];
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log('  done: ' + pkg.name);
NODEJS

  # create-mantle
  node << 'NODEJS'
const fs = require('fs');
const path = 'packages/create-mantle/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.description = 'Project initializer for Mantle JS — scaffold a new Mantle application via npm create mantle';
pkg.license = 'MIT';
pkg.keywords = ['mantle', 'create', 'scaffold', 'initializer', 'typescript'];
pkg.dependencies = { ...(pkg.dependencies || {}), '@mantlejs/cli': '^0.0.1' };
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
  log "Step 11: Smoke test — building @mantlejs/mantle"

  npx nx build mantle

  echo "✓ @mantlejs/mantle builds successfully"
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
  echo "    packages/mantle         → @mantlejs/mantle"
  echo "    packages/express        → @mantlejs/express"
  echo "    packages/koa            → @mantlejs/koa"
  echo "    packages/http           → @mantlejs/http"
  echo "    packages/knex           → @mantlejs/knex"
  echo "    packages/dynamodb       → @mantlejs/dynamodb"
  echo "    packages/supabase       → @mantlejs/supabase"
  echo "    packages/pinecone       → @mantlejs/pinecone"
  echo "    packages/qdrant         → @mantlejs/qdrant"
  echo "    packages/neo4j          → @mantlejs/neo4j"
  echo "    packages/auth           → @mantlejs/auth"
  echo "    packages/auth-local     → @mantlejs/auth-local"
  echo "    packages/auth-oauth     → @mantlejs/auth-oauth"
  echo "    packages/auth-google    → @mantlejs/auth-google"
  echo "    packages/auth-github    → @mantlejs/auth-github"
  echo "    packages/auth-facebook  → @mantlejs/auth-facebook"
  echo "    packages/storage        → @mantlejs/storage"
  echo "    packages/storage-s3     → @mantlejs/storage-s3"
  echo "    packages/storage-gcs    → @mantlejs/storage-gcs"
  echo "    packages/logger         → @mantlejs/logger"
  echo "    packages/schema         → @mantlejs/schema"
  echo "    packages/memory         → @mantlejs/memory"
  echo "    packages/config         → @mantlejs/config"
  echo "    packages/socketio       → @mantlejs/socketio"
  echo "    packages/sync           → @mantlejs/sync"
  echo "    packages/cli            → @mantlejs/cli"
  echo "    packages/create-mantle  → create-mantle"
  echo ""
  echo "  Open in VS Code:"
  echo "    code ${WORKSPACE_NAME}/mantle.code-workspace"
  echo ""
  echo "  Useful Nx commands:"
  echo "    npx nx graph                  # visualise the project graph"
  echo "    npx nx build mantle           # build a single package"
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
