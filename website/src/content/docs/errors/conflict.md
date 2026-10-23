---
title: Conflict
description: "HTTP 409 — The request conflicts with the current state of the resource."
sidebar:
  order: 6
---

**HTTP 409** · `className: "conflict"` · `throw new Conflict(message, data?, errors?, hint?)`

The request conflicts with the current state of the resource.

## When Mantle returns it

- `create` uses an id, or a unique value such as an email, that already exists. Every adapter that supports it reports a duplicate key as Conflict.
- A DynamoDB transaction was cancelled by a conflicting write.
- A request with the same `Idempotency-Key` is still being processed.

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Record with id u-1 already exists",
  "instance": "/users",
  "className": "conflict",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "Conflict", "message": …, "code": 409, "className": "conflict" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

For a duplicate, read the existing record or choose another value. For an in-flight idempotent request, wait and retry with the same key.
