---
title: NotAuthenticated
description: "HTTP 401 — The call needs an authenticated caller and didn't come with valid credentials."
sidebar:
  order: 2
---

**HTTP 401** · `className: "not-authenticated"` · `throw new NotAuthenticated(message, data?, errors?, hint?)`

The call needs an authenticated caller and didn't come with valid credentials.

## When Mantle returns it

- `authenticate("jwt")` found no `Authorization: Bearer …` token, or the token is invalid or expired.
- A local or OAuth sign-in failed (wrong email or password, a failed provider exchange).

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/not-authenticated",
  "title": "Not Authenticated",
  "status": 401,
  "detail": "Missing or invalid access token",
  "instance": "/users",
  "className": "not-authenticated",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "NotAuthenticated", "message": …, "code": 401, "className": "not-authenticated" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Sign in again, or refresh the access token. `@mantlejs/client` refreshes once automatically on a 401 when it holds a refresh token.
