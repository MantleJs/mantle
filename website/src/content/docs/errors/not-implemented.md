---
title: NotImplemented
description: "HTTP 501 — The server doesn't support the requested functionality."
sidebar:
  order: 11
---

**HTTP 501** · `className: "not-implemented"` · `throw new NotImplemented(message, data?, errors?, hint?)`

The server doesn't support the requested functionality.

## When Mantle returns it

- A service or adapter explicitly marks a capability as not implemented.

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/not-implemented",
  "title": "Not Implemented",
  "status": 501,
  "detail": "Full-text search is not implemented by this adapter",
  "instance": "/users",
  "className": "not-implemented",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "NotImplemented", "message": …, "code": 501, "className": "not-implemented" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Use a different method or adapter. This isn't fixed by retrying.
