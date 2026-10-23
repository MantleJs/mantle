---
title: GeneralError
description: "HTTP 500 — Something went wrong on the server."
sidebar:
  order: 10
---

**HTTP 500** · `className: "general-error"` · `throw new GeneralError(message, data?, errors?, hint?)`

Something went wrong on the server.

## When Mantle returns it

- An adapter hit a database error that doesn't map to a more specific class.
- Code threw something that isn't a `MantleError`. The response then carries no `detail` (or, with `errors: "mantle"`, a generic `message`), so internal messages never reach the caller.

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/general-error",
  "title": "General Error",
  "status": 500,
  "instance": "/users",
  "className": "general-error",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "GeneralError", "message": …, "code": 500, "className": "general-error" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Retrying may help if the cause was transient. Otherwise report it with the `requestId`, which matches the server's log lines for this request.
