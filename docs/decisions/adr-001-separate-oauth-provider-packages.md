# ADR-001: Separate npm Package per OAuth Provider

**Status:** Accepted  
**Date:** 2026-06-23

---

## Context

Mantle needs to support multiple OAuth 2.0 providers (GitHub, Google, and future providers). The question is how to package that support for consumers.

FeathersJS ships a single `@feathersjs/authentication-oauth` package that covers every provider via the `grant` library, which bundles a registry of 200+ providers and handles the full OAuth flow internally. That approach minimizes install count but pulls in a large transitive dependency regardless of which providers an application actually uses.

Each OAuth provider has meaningfully different requirements:

- GitHub uses the standard authorization code flow without PKCE.
- Google requires PKCE (Proof Key for Code Exchange) and uses OpenID Connect's `sub` claim as the user identifier.
- Future providers may require custom headers, non-standard token endpoints, or provider-specific profile normalization.

---

## Decision

Ship one npm package per OAuth provider (`@mantlejs/auth-github`, `@mantlejs/auth-google`, etc.) built on a shared base package (`@mantlejs/auth-oauth`) that owns the common flow: state management, PKCE primitives, route registration, and find-or-create logic.

Each provider package implements the `OAuthProvider` interface — a plain object with `buildAuthUrl`, `exchangeCode`, and `fetchProfile` — and calls `createOAuthPlugin` from the base. No class inheritance. No third-party provider registry.

---

## Options Considered

**A. Single `@mantlejs/auth-oauth` package with all providers built in**  
Simple to install. But every application pays for every provider's code and dependencies, versioning a bug in one provider forces a release that touches all of them, and the module boundary rule cannot be expressed per provider.

**B. Single package backed by the `grant` library**  
Gains 200+ providers for free. But `grant` manages its own session store, has its own config schema, does not support PKCE, and makes the HTTP contract opaque — a security audit must trace through a third-party library rather than reading the package source.

**C. Separate package per provider with a shared base (chosen)**  
Applications install only what they use. Each provider is independently versioned and auditable in a single source file. The Nx module boundary rule can be expressed per package. PKCE and other provider-specific requirements are handled without compromise.

---

## Consequences

**Easier:**
- Installing only the providers an application uses — no unused code in the bundle.
- Auditing a provider's full OAuth behavior — one short file per provider.
- Patching a provider independently — a GitHub endpoint change does not require a Google release.
- Expressing the dependency rule in `@nx/enforce-module-boundaries` at per-provider granularity.
- Adding a new provider without modifying any existing package.

**Harder:**
- Consumers must install multiple packages to support multiple providers.
- Adding a new provider requires creating and publishing a new package rather than adding a config entry.
