---
title: BadRequest
description: "HTTP 400 — The request is malformed or asks for something the service can't do as written."
sidebar:
  order: 1
---

**HTTP 400** · `className: "bad-request"` · `throw new BadRequest(message, data?, errors?, hint?)`

The request is malformed or asks for something the service can't do as written.

## When Mantle returns it

- A `where` clause uses an operator the adapter doesn't support (the message names the operator, and `hint` lists the supported ones).
- `get`, `update`, `patch`, or `remove` is called without an `id`.
- A batch has more calls than the endpoint's `maxSize` (default 25).
- A database rejects a value (Postgres SQLSTATE class `22`, or a non-unique constraint such as NOT NULL or a foreign key).

## Example response

With the transport option `errors: "problem+json"` ([RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "https://mantlejs.com/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Operator $regex is not supported by @mantlejs/knex",
  "instance": "/users",
  "className": "bad-request",
  "data": {
    "field": "metadata.tags"
  },
  "hint": "Use one of: $lt, $lte, $gt, $gte, $ne, $in, $nin, $like, $notlike, $ilike, $contains",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the default `errors: "mantle"`, the same error is `{ "name": "BadRequest", "message": …, "code": 400, "className": "bad-request" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Read `detail` and `hint`: they say which part of the request to change. Check the adapter's `describe().capabilities` before using an operator.
