# Note: Redis-backed auth stores — why Redis, and where they live

**Status:** Accepted
**Date:** 2026-07-17
**Relates to:** D-6 in the [AI-first review checklist](../planning/ai-first-review-checklist.md); interfaces from C-2 (`OAuthStateStore`) and B-1 (`RefreshTokenStore`)

## Why Redis

The `RefreshTokenStore` contract (`add` / `consume` / `revokeAll`) implies four requirements, and
Redis fits all of them:

1. **Shared state across instances.** The target deployment is Cloud Run — horizontally scaled,
   scale-to-zero. A refresh token issued by one instance must be consumable and revocable from any
   other, so the store must be external to the process.
2. **Atomic consume-once under concurrency.** Rotation treats a second use of a token as theft
   (a failed `consume` on a still-valid JWT triggers `revokeAll` in `@mantlejs/auth`). When two
   requests race on the same token — a retrying client, or an attacker replaying alongside the
   legitimate user — exactly one must win, or you get a false theft signal or a missed real one.
   Redis's `GETDEL` gives this in one command, with no locking.
3. **Expiry without a sweeper.** Every entry's lifetime is the token's own `exp`. `SET … EX` makes
   expiry the server's job — no cron, no cleanup queries, no unbounded growth.
4. **Hot path.** `consume` runs on every refresh fleet-wide; it is a tiny key-value lookup, which
   is Redis's sweet spot, and keeps ephemeral auth bookkeeping off the domain database.
   Operationally, `@mantlejs/sync` already names Redis as a cross-instance backend, so one is
   plausibly present in the deployment.

Rejected alternatives: **stateless** (no store) cannot revoke or detect rotation reuse — the store
_is_ the revocation capability; **the main database** is workable through the same interface (which
is why it is sync-or-async) but needs sweeper logic and explicit locking for consume-once, and ties
auth bookkeeping to the app's adapter choice.

The same reasoning covers `OAuthStateStore` in weaker form: cross-instance visibility (the OAuth
callback can land on a different instance than the one that started the flow) and server-side TTL
expiry, without the atomicity requirement.

Note that the decision is really "Redis _semantics_ — atomic `GETDEL` plus TTLs — are the right
primitive": the package types its client structurally (see below), so any compatible store works.

## Where the implementations live

D-6 required a location decision for the production Redis implementations of `RefreshTokenStore`
(`@mantlejs/auth`) and `OAuthStateStore` (`@mantlejs/auth-oauth`): a dedicated package, or optional
exports inside the existing auth packages behind an `ioredis` peer dependency.

**Decision: a dedicated `@mantlejs/auth-redis` package.**

- It keeps the dependency matrix clean — `auth` and `auth-oauth` stay Redis-free, and
  `auth-redis` depends on `mantle`, `auth`, and `auth-oauth` (type-only, as peer dependencies).
- It matches the established adapter pattern (`storage-s3`/`storage-gcs` extend `storage` the
  same way).
- Optional exports would have forced an `ioredis` peer dependency onto every `auth` consumer's
  install output even when unused, and conditional exports for optional peers complicate the
  otherwise-uniform tsc build.

Two refinements made during implementation:

1. **No hard `ioredis` dependency at all.** The stores type the client structurally as
   `RedisClientLike` — the eight commands they need, shaped to match `ioredis`. Any compatible
   client works; specs run against `ioredis-mock`. Requires Redis ≥ 6.2 (`GETDEL` is the atomic
   consume-once primitive for refresh-token rotation).
2. **`OAuthStateStore` methods widened to sync-or-async** (`void | Promise<void>` etc.), matching
   the pattern `RefreshTokenStore` already used, and `createOAuthPlugin` awaits the store. This is
   a pre-release interface change; existing sync implementations still conform.
