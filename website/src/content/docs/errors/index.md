---
title: Errors
description: Every error class Mantle returns, what causes it, and how to fix it.
sidebar:
  order: 0
  label: Overview
---

Mantle reports failures as typed errors. A service or hook throws a `MantleError` subclass, and every transport
turns it into a response with the matching HTTP status — never a plain `new Error()`.

| Class                                                | Status | Meaning                                                                         |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| [`BadRequest`](/errors/bad-request/)                 | 400    | The request is malformed or asks for something the service can't do as written. |
| [`NotAuthenticated`](/errors/not-authenticated/)     | 401    | The call needs an authenticated caller and didn't come with valid credentials.  |
| [`Forbidden`](/errors/forbidden/)                    | 403    | The caller is known but isn't allowed to do this.                               |
| [`NotFound`](/errors/not-found/)                     | 404    | The record, service, or route doesn't exist, or isn't visible to this caller.   |
| [`MethodNotAllowed`](/errors/method-not-allowed/)    | 405    | The service exists but doesn't offer this method.                               |
| [`Conflict`](/errors/conflict/)                      | 409    | The request conflicts with the current state of the resource.                   |
| [`PreconditionFailed`](/errors/precondition-failed/) | 412    | A condition the caller set on the request isn't met.                            |
| [`Unprocessable`](/errors/unprocessable/)            | 422    | The request is well-formed but the data in it isn't valid.                      |
| [`TooManyRequests`](/errors/too-many-requests/)      | 429    | The caller has sent too many requests in the current window.                    |
| [`GeneralError`](/errors/general-error/)             | 500    | Something went wrong on the server.                                             |
| [`NotImplemented`](/errors/not-implemented/)         | 501    | The server doesn't support the requested functionality.                         |
| [`Unavailable`](/errors/unavailable/)                | 503    | A backing service is temporarily unreachable or overloaded.                     |

## Response formats

The HTTP transports (`@mantlejs/express`, `@mantlejs/koa`, `@mantlejs/http`) take an `errors` option:

- `"mantle"` (default): `MantleError.toJSON()` as `application/json` — `name`, `message`, `code`, `className`, plus
  `data`, `errors`, and `hint` when set.
- `"problem+json"`: [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) as `application/problem+json`.
  `type` links to this page for the error's class; `title` is the class name in words, `status` the HTTP status,
  `detail` the message, and `instance` the request path. `className`, `data`, `errors`, `hint`, and `requestId` are
  extension members.

```typescript
app.configure(express(undefined, { errors: "problem+json" }));
```

`@mantlejs/client` reads both formats into the same `MantleClientError`, choosing by `Content-Type`.

An error class you define yourself (a `MantleError` subclass with your own `className`) has no page here, so its
Problem Details `type` is `about:blank`, meaning "see the HTTP status". An unexpected error that isn't a `MantleError`
becomes a 500 [`GeneralError`](/errors/general-error/); in `problem+json` it carries no `detail`, so internal messages
don't reach the caller.

Every error response also carries the request's `X-Request-Id` header (and `requestId` in Problem Details), which
matches the `requestId` on the server's log lines for that request.
