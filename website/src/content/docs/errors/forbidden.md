---
title: Forbidden
description: "HTTP 403 — The caller is known but isn't allowed to do this."
sidebar:
  order: 3
---

**HTTP 403** · `className: "forbidden"` · `throw new Forbidden(message, data?, errors?, hint?)`

The caller is known but isn't allowed to do this.

## When Mantle returns it

- An agent token's capability scope doesn't include this service path and method (`authorizeAgent()` in [`@mantlejs/auth`](/packages/auth/)).
- A hook in the app refuses the call (for example, a tenant or ownership check).
- The database refuses it: insufficient privilege, including a Postgres row-level security policy rejecting the row (SQLSTATE `42501`, or class `28`).

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Agent scope does not allow 'invoices.remove'",
  "instance": "/users",
  "className": "forbidden",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "Forbidden", "message": …, "code": 403, "className": "forbidden" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Use a principal that has the permission, or widen the agent token's scope when issuing it. Don't retry unchanged.
