# ADR-002: Adopt Arctic for OAuth Internals

**Status:** Accepted  
**Date:** 2026-07-16

---

## Context

ADR-001 established one npm package per OAuth provider on a shared `@mantlejs/auth-oauth` base, with each
provider implementing the `OAuthProvider` interface (`buildAuthUrl`, `exchangeCode`, `fetchProfile`). It
rejected the `grant` library and chose hand-written flows, accepting the consequence that adding a provider
means writing a full endpoint implementation.

The AI-first architecture review (§3) re-examined the auth stack against two libraries:

- **Better Auth** — a full auth framework that owns its own database tables, migrations, and session
  semantics. Adopting it would break the Dependency Rule at the auth boundary: `Repository<T>` could no
  longer own the user table, and auth-driven user mutations would bypass the hook pipeline that
  `findOrCreateUser` currently goes through. It also duplicates what `@mantlejs/auth` already provides
  (JWT issuance, strategy dispatch, `authenticate("jwt")`).
- **Arctic** (arcticjs.dev) — a zero-framework library of per-provider OAuth 2.0/OIDC clients (~60
  providers, three small `@oslojs/*` deps). It handles exactly what each Mantle provider package
  hand-writes — authorization URL construction and code exchange, with PKCE built in — and has no opinions
  about routing, sessions, or storage, so it slots *inside* `createOAuthPlugin` without touching Mantle's
  architecture.

Implementation surfaced one contract friction: `AuthUrlParams` passed a pre-computed `codeChallenge` to
`buildAuthUrl`, while Arctic's `createAuthorizationURL(state, codeVerifier, scopes)` takes the *verifier*
and derives the S256 challenge internally. Keeping the old field would have meant constructing Arctic URLs
with a dummy verifier and manually overwriting the challenge parameter. Since nothing is published yet
(same reasoning as the pre-release `cypher()` → `raw()` rename), the contract was nudged instead.

---

## Decision

Adopt `arctic` as an implementation dependency of `@mantlejs/auth-oauth` and the three provider packages.

- **`OAuthProvider` stays the public contract** — `buildAuthUrl` / `exchangeCode` / `fetchProfile`,
  registered through `createOAuthPlugin` exactly as before. One field changed pre-release:
  `AuthUrlParams.codeChallenge` became `AuthUrlParams.codeVerifier`, aligning the contract with how PKCE
  libraries (and RFC 7636 flows generally) are structured — the verifier is the secret that travels;
  challenges are derived.
- **Provider packages construct Arctic clients per call** for `buildAuthUrl` and `exchangeCode`
  (`new Google(clientId, clientSecret, redirectUri)` etc. — redirect URIs are request-derived, so clients
  are built per request; they are trivially cheap). Arctic errors are wrapped in Mantle's typed
  `GeneralError`.
- **Profile fetching stays hand-written** — Arctic deliberately does not normalize profiles, and the
  per-provider userinfo call plus normalization to `OAuthProfile` is the part worth auditing per provider.
- **`pkce.ts` is deleted** — `createOAuthPlugin` uses Arctic's `generateState()` and
  `generateCodeVerifier()`; challenge derivation lives inside Arctic. The state store keeps storing the
  verifier keyed by state, unchanged.

---

## Options Considered

**A. Keep the hand-written flows (status quo)**  
Auditable and working, but every new provider is a full endpoint implementation (ADR-001's accepted
"harder" consequence), and endpoint drift is ours to track — e.g. the hand-written Facebook flow had
already pinned a Graph API version by hand and used a GET token exchange where Arctic ships the
maintained POST flow.

**B. Better Auth**  
Full-featured (2FA, magic links, organizations), but it owns the user table and sessions, which breaks
the Dependency Rule and bypasses the hook pipeline for auth-driven mutations. Right call for an app;
wrong call for a framework whose differentiator is a swappable data layer.

**C. Arctic inside `auth-oauth`, contract frozen**  
Adopt Arctic but keep `AuthUrlParams.codeChallenge`. Requires constructing authorization URLs with a
dummy verifier and overwriting the challenge param — fighting the library — and keeps the hand-rolled
challenge derivation alive solely to feed a field the providers no longer want.

**D. Arctic inside `auth-oauth`, verifier-based contract (chosen)**  
One pre-release field rename (`codeChallenge` → `codeVerifier`) lets Arctic own all PKCE derivation and
deletes `pkce.ts` outright. ADR-001's package-per-provider structure, per-provider auditability, and the
`OAuthProvider` shape are all preserved.

---

## Consequences

**Easier:**

- Adding a provider is now ~30 lines: construct the Arctic client for URL + exchange, write profile
  normalization. Directly addresses ADR-001's "harder" consequence.
- Endpoint and protocol maintenance (token endpoints, API versions, PKCE, quirks like GitHub's Basic-auth
  token exchange) is delegated to a widely-used, focused library instead of tracked by hand.
- Provider packages shrink to the genuinely provider-specific part — profile normalization — which is the
  surface a security audit actually needs to read.

**Harder / changed:**

- One new external dependency tree in the auth packages (`arctic` + three `@oslojs/*` packages).
- Provider wire behavior follows Arctic's choices: GitHub token exchange authenticates via Basic auth
  header instead of body credentials; Facebook token exchange is a POST against the Arctic-pinned Graph
  API version (v16.0 at adoption) instead of the hand-pinned v18.0 GET; scopes are space-joined per RFC
  6749 (Facebook accepts both separators).
- Specs that asserted implementation details (exact `fetch(url, options)` call shapes, hand-fed
  challenge propagation) were updated to assert the same behavior through Arctic's `Request`-based
  fetches; behavior-level assertions were unchanged.
