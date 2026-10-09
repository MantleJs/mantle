---
title: Authentication
description: JWT sessions with @mantlejs/auth, local email+password and OAuth sign-in, rotating refresh tokens, and what changes when you run more than one instance.
sidebar:
  order: 2
---

Authentication is split in two: **`@mantlejs/auth`** is the engine — JWT issuance and verification, the
`POST /authentication` endpoint, and the hooks — and **strategy packages** plug sign-in methods into it.

| Strategy                                                | Sign-in method                            |
| ------------------------------------------------------- | ----------------------------------------- |
| [`@mantlejs/auth-local`](/packages/auth-local/)         | Email + password, hashed with Argon2id    |
| [`@mantlejs/auth-google`](/packages/auth-google/)       | Google (authorization code + PKCE)        |
| [`@mantlejs/auth-github`](/packages/auth-github/)       | GitHub                                    |
| [`@mantlejs/auth-facebook`](/packages/auth-facebook/)   | Facebook                                  |
| [`@mantlejs/auth-apple`](/packages/auth-apple/)         | Sign in with Apple (`form_post` callback) |
| [`@mantlejs/auth-microsoft`](/packages/auth-microsoft/) | Microsoft Entra ID (PKCE)                 |
| [`@mantlejs/auth-linkedin`](/packages/auth-linkedin/)   | LinkedIn (OpenID Connect)                 |
| [`@mantlejs/auth-twitter`](/packages/auth-twitter/)     | Sign in with X (PKCE)                     |

The OAuth strategies share one base, [`@mantlejs/auth-oauth`](/packages/auth-oauth/) — state handling, PKCE,
and find-or-create of the local user — and none of them uses Passport.js.

## Local sign-in

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.use("users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "patch", "remove"],
});

app.service("users").hooks({
  before: {
    create: [hashPassword()], // registration stays public; the password is stored as an Argon2id hash
    patch: [authenticate("jwt"), hashPassword()],
    find: [authenticate("jwt")],
    get: [authenticate("jwt")],
    remove: [authenticate("jwt")],
  },
  after: { all: [sanitizeUser()] }, // never send password hashes back
});
```

The flow over HTTP:

1. `POST /users` with `{ "email", "password" }` registers a user.
2. `POST /authentication` with `{ "strategy": "local", "email", "password" }` returns an access token, a refresh
   token, and the user.
3. Requests carry `Authorization: Bearer <accessToken>`; `authenticate("jwt")` verifies it and puts the decoded
   payload on `params.user`.

Internal calls — a service calling another service without a `provider` — skip `authenticate("jwt")`, which is
how strategies look up users without tripping the guards they protect.

## OAuth sign-in

```typescript
import { googleStrategy } from "@mantlejs/auth-google";

app.configure(
  googleStrategy({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUrl: "https://app.example.com/",
  }),
);
```

Send the browser to `GET /auth/google` with a full-page navigation (a link, not `fetch`). After consent the
provider calls back, the strategy finds or creates the user, and — with `redirectUrl` set — redirects to your
frontend with `#accessToken=…&refreshToken=…` in the URL **fragment**, so tokens never reach a server log or a
`Referer` header. The [`auth-provider`](/blocks/auth-provider/) and [`oauth-buttons`](/blocks/oauth-buttons/)
UI blocks handle both ends of that for you.

## Refresh tokens

Every login returns an access + refresh token pair. Exchange the refresh token on the same endpoint:

```json
POST /authentication
{ "strategy": "refresh", "refreshToken": "eyJhbGciOiJIUzI1NiJ9..." }
```

Refresh tokens **rotate**: each exchange consumes the token and issues a new pair. Replaying a consumed token is
treated as theft — every outstanding refresh token for that user is revoked. [`@mantlejs/client`](/packages/client/)
does the exchange automatically on a `401`, with concurrent requests sharing a single refresh.

## Running more than one instance

The engine's default stores are in memory: fine for one process, wrong behind a load balancer, where a refresh
or an OAuth callback can land on a different instance than the one that issued the token or the state. Inject
the Redis-backed stores from [`@mantlejs/auth-redis`](/packages/auth-redis/) — `redisRefreshTokenStore` into
`auth({ refreshTokenStore })` and `redisStateStore` into each OAuth strategy's `stateStore` option. Both consume entries atomically, so a
replayed callback or a double-submitted refresh can't succeed twice.

## Agents

Calls from AI agents get their own short-lived, capability-scoped tokens — distinct from user JWTs and opt-in per
route. See [Agents](/guides/agents/).
