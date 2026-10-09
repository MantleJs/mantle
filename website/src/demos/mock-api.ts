/**
 * The mocked Mantle server behind every block demo. Demos use a real `@mantlejs/client` (and, for the
 * realtime list, a fake Socket.IO socket) — only the network is simulated: `fetch` calls to
 * {@link DEMO_API} are answered in-process with the same JSON shapes a Mantle app returns (a
 * `Paginated<T>` envelope from `find`, `MantleError.toJSON()` bodies for errors), and every other
 * request passes through untouched. Nothing leaves the browser.
 */

/** Base URL the demo clients talk to. `.invalid` is reserved (RFC 2606), so it can never resolve. */
export const DEMO_API = "https://demo.mantlejs.invalid";

/** Simulated network latency, so loading and pending states are visible. */
const LATENCY_MS = 350;

export const DEMO_EMAIL = "ada@example.com";
export const DEMO_PASSWORD = "correct-horse";

export interface Article extends Record<string, unknown> {
  id: number;
  title: string;
  author: string;
  views: number;
}

type Row = Record<string, unknown> & { id: number };

const TITLES = [
  "Layered architecture without the ceremony",
  "Why services are contracts",
  "Repositories in the infrastructure layer",
  "One hook pipeline for every transport",
  "Typed errors that carry hints",
  "Paginating with $limit and $skip",
  "Realtime events over Socket.IO",
  "Syncing events across instances",
  "Local auth with Argon2id",
  "OAuth without Passport.js",
  "Refresh-token rotation and reuse detection",
  "Agent tokens and capability scopes",
  "An audit trail as a Repository",
  "Auto-embedding on write",
  "Exposing services over MCP",
  "MCP code mode in a QuickJS sandbox",
  "Uploading files with busboy",
  "S3 and GCS storage adapters",
  "Querying nested JSON paths",
  "The $contains operator across adapters",
  "OpenAPI from service metadata",
  "Testing with the memory repository",
  "React hooks over TanStack Query",
  "Shipping to Cloud Run",
  "React Aria blocks from a shadcn registry",
];
const AUTHORS = ["Ada", "Grace", "Linus", "Margaret", "Ken"];

function seedArticles(): Row[] {
  return TITLES.map((title, index) => ({
    id: index + 1,
    title,
    author: AUTHORS[index % AUTHORS.length],
    views: ((index * 7919) % 900) + 40,
  }));
}

interface Collection {
  rows: Row[];
  nextId: number;
  /** Operators the simulated adapter rejects, as `assertOperators` would (BadRequest naming the operator). */
  unsupported: Set<string>;
}

const collections = new Map<string, Collection>();

function collection(path: string): Collection {
  let found = collections.get(path);
  if (!found) {
    const rows = path === "articles" || path === "notes" ? seedArticles() : [];
    // `notes` stands in for an adapter without $ilike (e.g. knex on SQLite, Neo4j) — the search demo
    // shows search-combobox falling back to $like after the adapter's BadRequest.
    found = { rows, nextId: rows.length + 1, unsupported: new Set(path === "notes" ? ["$ilike"] : []) };
    collections.set(path, found);
  }
  return found;
}

/** Create a record as another client would have — demos broadcast the result over their fake socket. */
export function serverCreate(path: string, data: Record<string, unknown>): Row {
  const target = collection(path);
  const row: Row = { ...data, id: target.nextId++ };
  target.rows.push(row);
  return row;
}

export function serverPatch(path: string, id: number, data: Record<string, unknown>): Row | undefined {
  const row = collection(path).rows.find((candidate) => candidate.id === id);
  if (row) Object.assign(row, data);
  return row;
}

export function serverRemove(path: string, id: number): Row | undefined {
  const target = collection(path);
  const index = target.rows.findIndex((candidate) => candidate.id === id);
  return index >= 0 ? target.rows.splice(index, 1)[0] : undefined;
}

export function serverRows(path: string): Row[] {
  return [...collection(path).rows];
}

// ---------------------------------------------------------------------------------------------------
// fetch interception
// ---------------------------------------------------------------------------------------------------

let installed = false;

/** Route `fetch` calls for {@link DEMO_API} to the in-process server. Idempotent. */
export function installMockFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(DEMO_API)) return realFetch(input, init);
    await delay(LATENCY_MS);
    return handle(new URL(url), init?.method ?? "GET", init?.body);
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** `MantleError.toJSON()` — what every Mantle transport sends for a thrown typed error. */
function mantleError(name: string, code: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ name, message, code, className: kebab(name), ...extra }, code);
}

function kebab(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function handle(url: URL, method: string, body: BodyInit | null | undefined): Response {
  const [path, id] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const data = typeof body === "string" && body.length > 0 ? (JSON.parse(body) as Record<string, unknown>) : {};

  if (path === "authentication") {
    if (id === "logout") return json({});
    return authenticate(data);
  }
  if (path === "users" && method === "POST") return createUser(data);

  const target = collection(path);
  if (method === "GET" && id === undefined) {
    try {
      return json(find(target, parseQuery(url.searchParams)));
    } catch (error) {
      return error instanceof Response ? error : mantleError("GeneralError", 500, String(error));
    }
  }
  if (method === "GET") {
    const row = target.rows.find((candidate) => String(candidate.id) === id);
    return row ? json(row) : mantleError("NotFound", 404, `No record found for id '${id}'`);
  }
  if (method === "POST") return json(serverCreate(path, data), 201);
  return mantleError("MethodNotAllowed", 405, `Method ${method} is not mocked in the demo`);
}

const users = new Map<string, { id: number; email: string; name?: string; password: string }>([
  [DEMO_EMAIL, { id: 1, email: DEMO_EMAIL, name: "Ada Lovelace", password: DEMO_PASSWORD }],
]);

function authenticate(data: Record<string, unknown>): Response {
  if (data["strategy"] !== "local") {
    return mantleError("BadRequest", 400, `Strategy '${String(data["strategy"])}' is not registered`);
  }
  const user = users.get(String(data["email"]));
  if (!user || user.password !== data["password"]) {
    return mantleError("NotAuthenticated", 401, "Invalid email or password");
  }
  return json(
    {
      accessToken: `demo-access-${user.id}`,
      refreshToken: `demo-refresh-${user.id}`,
      user: { id: user.id, email: user.email, name: user.name },
    },
    201,
  );
}

/** `@mantlejs/schema`'s `validate()` reports `Unprocessable` with `data.errors: [{ field: "/email", message }]`. */
function createUser(data: Record<string, unknown>): Response {
  const email = String(data["email"] ?? "");
  const password = String(data["password"] ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return mantleError("Unprocessable", 422, "Validation failed", {
      data: { errors: [{ field: "/email", message: "Enter a valid email address." }] },
    });
  }
  if (users.has(email)) return mantleError("Conflict", 409, "An account with that email already exists");
  const user = { id: users.size + 1, email, name: String(data["name"] ?? ""), password };
  users.set(email, user);
  return json({ id: user.id, email: user.email, name: user.name }, 201);
}

// ---------------------------------------------------------------------------------------------------
// The query semantics `RepositoryService` gives a real app, for the subset the blocks use
// ---------------------------------------------------------------------------------------------------

type Query = Record<string, unknown>;

/** Bracket-notation query string → nested object (what `@mantlejs/mantle`'s `parseQueryString` does). */
function parseQuery(params: URLSearchParams): Query {
  const result: Query = {};
  for (const [key, value] of params) {
    const segments = key.split(/\[|\]\[|\]/).filter((segment) => segment !== "");
    let node: Query = result;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) node[segment] = value;
      else node = (node[segment] ??= {}) as Query;
    });
  }
  return result;
}

const RESERVED = new Set(["$limit", "$skip", "$sort", "$select"]);

function find(target: Collection, query: Query) {
  const where = Object.fromEntries(Object.entries(query).filter(([key]) => !RESERVED.has(key)));
  for (const condition of Object.values(where)) {
    if (condition && typeof condition === "object") {
      for (const operator of Object.keys(condition)) {
        if (target.unsupported.has(operator)) {
          throw mantleError("BadRequest", 400, `Unsupported query operator: ${operator}`, {
            hint: "Rewrite the where clause using only the operators this adapter's describe() reports.",
          });
        }
      }
    }
  }
  let rows = target.rows.filter((row) => matches(row, where));
  const sort = (query["$sort"] ?? {}) as Record<string, string>;
  for (const [field, direction] of Object.entries(sort).reverse()) {
    const sign = direction === "desc" || direction === "-1" ? -1 : 1;
    rows = [...rows].sort((a, b) => compare(a[field], b[field]) * sign);
  }
  const total = rows.length;
  const limit = query["$limit"] === undefined ? 25 : Number(query["$limit"]);
  const skip = query["$skip"] === undefined ? 0 : Number(query["$skip"]);
  const select = query["$select"] ? Object.values(query["$select"] as Record<string, string>) : undefined;
  const data = rows
    .slice(skip, skip + limit)
    .map((row) => (select ? Object.fromEntries(Object.entries(row).filter(([key]) => select.includes(key))) : row));
  return { total, limit, skip, data };
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function matches(row: Row, where: Query): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = row[field];
    if (condition === null || typeof condition !== "object") return String(value) === String(condition);
    return Object.entries(condition as Record<string, string>).every(([operator, operand]) => {
      if (operator === "$ilike") return likePattern(operand, "i").test(String(value ?? ""));
      if (operator === "$like") return likePattern(operand, "").test(String(value ?? ""));
      return true;
    });
  });
}

/** SQL LIKE → RegExp (`%` any run, `_` one character). */
function likePattern(pattern: string, flags: string): RegExp {
  const source = pattern
    .split("")
    .map((char) => (char === "%" ? ".*" : char === "_" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`, flags);
}
