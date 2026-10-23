---
title: NotFound
description: "HTTP 404 — The record, service, or route doesn't exist, or isn't visible to this caller."
sidebar:
  order: 4
---

**HTTP 404** · `className: "not-found"` · `throw new NotFound(message, data?, errors?, hint?)`

The record, service, or route doesn't exist, or isn't visible to this caller.

## When Mantle returns it

- `get`, `update`, `patch`, or `remove` names an id with no record.
- The service path isn't registered, or the URL matches no route.
- The record exists but belongs to another tenant: Mantle answers NotFound rather than Forbidden so it doesn't reveal that the record exists.

## Example response

With the transport option `errors: "problem+json"` ([RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "https://mantlejs.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "No record found with id = 42",
  "instance": "/users/42",
  "className": "not-found",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the default `errors: "mantle"`, the same error is `{ "name": "NotFound", "message": …, "code": 404, "className": "not-found" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Check the id and path. A NotFound right after a create usually means the id was mistyped or the record was created under a different tenant.
