# MantleJS → BaaS readiness: gap analysis & priorities

This doc is a planning input for Claude Code. It answers one question: **given the current
state of the MantleJS monorepo, what needs to be hardened vs. newly built to make Mantle a
credible foundation for a hosted BaaS platform** (separate control-plane app, built later, not
covered here — see "Explicitly out of scope" below).

Read `CLAUDE.md` first for architecture rules, the package dependency matrix, and coding
conventions — this doc assumes and extends that context. Where this doc says "verify," it means
the claim is inferred from the README/CLAUDE.md package descriptions, not confirmed against the
actual implementation — check the code before treating it as fact.

## Bottom line

The package surface is already unusually complete for something at this stage: three transports,
six relational/document/graph adapters, two vector-store adapters, nine auth packages, three
storage adapters, real-time sync, OpenAPI generation, and an MCP server. This is not "a library
that needs more packages" — it's a library that needs **conformance hardening across what exists**,
plus **three small, targeted additions** that turn the existing architecture into the specific
positioning the market research validated: the polyglot, agent-native, audit-first BaaS. Resist
the urge to add packages beyond those three; every adapter/provider package you already have is
better spent finishing than duplicating.

---

## Part 1 — Harden what exists (do this first)

### 1.1 Adapter conformance parity

The `QueryParams` operator table in `CLAUDE.md` already documents real unevenness across
adapters:

- `$contains` (jsonb containment) works on memory, supabase, knex-on-pg, dynamodb, mongodb — but
  **not** on knex-mysql, knex-sqlite, knex-mssql, neo4j, pinecone, or qdrant.
- Nested dot-path queries (`"metadata.tags"`) work on memory, supabase, mongodb — but not on the
  other seven adapters.

This directly undercuts the "swap the adapter without touching business logic" pitch, which is
the whole point of the Repository abstraction and the core of the polyglot-BaaS positioning. Two
acceptable outcomes, not necessarily "implement everywhere":

- **Extend** the operator to every adapter where it's semantically possible (e.g. MySQL 5.7+ and
  MSSQL both have JSON functions that can approximate `$contains`), or
- **Formalize the gap** as a documented adapter capability matrix (`Repository.capabilities` or
  similar), so a developer — or an AI agent scaffolding against a given adapter — gets a
  compile-time or runtime signal instead of a silent behavior difference discovered in production.

The `assertOperators` rejection path already exists for unsupported operators — the missing piece
is making capability differences *discoverable before* a query is attempted, not just rejected
after.

### 1.2 Cross-adapter write consistency

`CLAUDE.md`'s multi-repository section already documents, correctly and honestly, that
cross-adapter writes (e.g. Knex + Mongo) are not atomic — no distributed transaction, design for
eventual consistency. This same limitation is about to become load-bearing: the auto-embed hook
proposed in Part 2 is *by definition* a cross-adapter write (SQL/Mongo row → vector store). Before
building that hook, decide and document the standard pattern once — e.g. an outbox-style retry, or
"embed writes are idempotent upserts keyed on the source row id, safe to retry, non-fatal on
failure" — so every future cross-adapter hook follows the same rule instead of each one inventing
its own.

### 1.3 `@mantlejs/mcp` — verify before extending

This package is the single most strategically important one for the agent-native positioning, so
it deserves the most scrutiny before new work lands on top of it. Verify:

- **Manifest source of truth.** Do `@mantlejs/openapi` and `@mantlejs/mcp` both introspect the same
  service-registration metadata in `@mantlejs/mantle`, or does each package do its own
  introspection? If the latter, unify them — an MCP tool description and an OpenAPI operation that
  can drift apart is exactly the "agent trusts a stale tool description" failure mode the research
  flagged as a real incident pattern elsewhere in the industry.
- **What "deny-by-default" currently means in practice.** Confirm it denies at the granularity of
  individual service methods (not just "tools are opt-in at the server level") and that it composes
  with the existing `before`/`after`/`error` hook pipeline rather than sitting outside it — i.e. an
  MCP-originated call and an HTTP-originated call hitting the same service should run through
  identical `authenticate`/`authorize` hooks, differing only in `HookContext.provider`.
- **Whether raw query passthrough is possible anywhere in the MCP surface.** It shouldn't be — the
  whole structural advantage over Supabase's MCP incidents depends on agents only ever calling
  typed `Service<T>` methods, never raw SQL. Confirm there's no code path (current or planned) that
  lets an MCP tool execute arbitrary queries.

### 1.4 Auth package — hardening, not more providers

Nine auth packages covering seven identity providers is already more breadth than most BaaS
platforms ship. Don't add more OAuth strategies. Instead: confirm refresh-token rotation,
`auth-redis`'s multi-instance store, and PKCE state handling are exercised by tests under
concurrent/multi-instance conditions, since these are the parts that fail silently in production
rather than at compile time.

---

## Part 2 — Three targeted additions

Each of these is small, builds directly on existing primitives (the hook pipeline, the Repository
abstraction, `@mantlejs/mcp`), and maps to the specific gap the competitive research identified as
unclaimed in the market. None of these should require new architectural concepts beyond what
`CLAUDE.md` already defines.

### 2.1 Agent identity + capability scopes (extends `@mantlejs/auth` and `@mantlejs/mcp`)

The gap: today, per the package table, an MCP client is presumably authenticated the same way an
HTTP client is (a JWT, or nothing, per whatever hooks are configured). There's no principal type
distinct from "a user" — no way to say "this MCP session may call `articles.create` and
`articles.find`, nothing else, for the next hour, and every call it makes is attributable to this
specific agent session."

The addition: an `AgentPrincipal` concept — short-lived, capability-scoped (verb × service path),
revocable, distinguishable in `HookContext` from a human `principal`. Concretely, this likely means:

- A token-issuance flow (probably in `@mantlejs/auth`, since it already owns the JWT engine) that
  mints agent tokens with an explicit capability list, separate from user JWTs and from any
  server-side/service-role key.
- An `authorizeAgent()` hook (alongside the existing `authenticate()`) that checks the token's
  capability list against `HookContext.path` + `HookContext.method`, denying by default — this is
  the same enforcement point `@mantlejs/mcp` already uses, just with a narrower, agent-specific
  check.
- `HookContext` gains a way to distinguish "this call came from an agent session, here's its scope
  and delegating user" from an ordinary authenticated request.

This is the single highest-leverage addition: no mainstream BaaS ships a first-class agent
identity distinct from a full user JWT or a full-access service key, and Mantle's hook-pipeline
architecture is already the right shape to add it incrementally rather than bolt it on.

### 2.2 Audit hook (`@mantlejs/audit` — small, new package)

The gap: no package currently records what happened when an agent (or anyone) called a service —
only structured request/error logging (`@mantlejs/logger`), which is observability, not an
audit trail scoped to *who did what, as which identity, with what result*.

The addition: a hook, attachable to `before`/`after`/`error` like any other, that records
`{ principal, agentId?, path, method, params, result summary, timestamp }` to a pluggable sink.
The elegant part: the sink can just be **a `Repository<T>` you already have** — audit records are
themselves a Mantle service backed by whatever adapter (Postgres, Mongo, whatever) the deployment
already uses. This dogfoods the framework instead of introducing a new storage concept, and it's
what makes "what did my agents actually do to my data" a queryable answer instead of a grep
through logs. Pair naturally with 2.1: log the `AgentPrincipal`'s scope and the delegating user on
every entry.

### 2.3 Auto-embed-on-write hook (`@mantlejs/embeddings` — verify scope before building)

The gap, *if it exists*: `@mantlejs/pinecone` and `@mantlejs/qdrant` are described as having
"embedding support," and MongoDB has Atlas Vector Search via `MongoVectorRepository." **First
verify what that actually means in the current code**: does the developer still have to call an
embedding provider themselves and hand the adapter a ready-made vector, or does the adapter
generate the embedding for you? This matters because it's the difference between "already done"
and "needs a new package."

If it's the former (developer supplies the vector), the addition is a hook — `after: { create:
[embed({ field: "body", provider: openaiEmbeddings() })] }` — that calls a pluggable embedding
provider and upserts into whichever vector adapter is configured, on write. Apply the Part 1.2
consistency rule here directly: this is a cross-adapter write, so it should be an idempotent
upsert keyed on the source record's id, safe to retry, and its failure should not roll back or
block the primary write.

This is the concrete, demonstrable "one line instead of a hand-written trigger" advantage over
Supabase's pgvector-plus-Edge-Function setup that the research flagged as commonly reported as
fragile.

---

## Explicitly out of scope for the `mantle` monorepo

These came up in earlier strategy discussion as things a hosted BaaS needs, but they belong in the
**separate control-plane application**, not in MantleJS itself — don't let scope creep put them in
this repo:

- Multi-tenant project provisioning, per-tenant database isolation
- Studio/dashboard UI (table browser, auth admin, logs, agent-activity view)
- Billing/quota enforcement
- Secrets/env management across tenants
- Migration/schema-diff UX beyond what `@mantlejs/cli`'s scaffolding already does

The control-plane app is the thing that *uses* Mantle (via `@mantlejs/express` or `@mantlejs/http`,
`@mantlejs/auth`, `@mantlejs/mcp`, etc.) to run one backend per customer — per the existing tech
decision to deploy on Cloud Run paired with Cloud SQL. That's a different codebase with a different
job, and it can be scoped separately once the framework-level items above are solid.

---

## Suggested sequencing

1. **Adapter conformance matrix** (1.1) — foundational; every other item assumes the polyglot
   story is actually true across adapters, not just true for the three best-supported ones.
2. **Verify `@mantlejs/mcp`'s manifest source and hook composition** (1.3) — cheap to check, and
   everything in Part 2 builds on top of it.
3. **Agent identity + capability scopes** (2.1) — the highest-leverage new work; the market
   research identified this as unclaimed.
4. **Audit hook** (2.2) — small, pairs directly with 2.1, ships the "audit-first" half of the
   positioning.
5. **Auto-embed hook** (2.3) — verify scope first; may be partially done already.
6. **Cross-adapter write consistency pattern** (1.2) — formalize once 2.3 gives you a concrete
   case to design it against, rather than in the abstract.

Everything under "explicitly out of scope" starts only after the above is solid — building the
control plane on a framework whose polyglot story or agent-auth story isn't actually finished
just moves the same problems one layer up.
