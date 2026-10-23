---
title: Unprocessable
description: "HTTP 422 — The request is well-formed but the data in it isn't valid."
sidebar:
  order: 8
---

**HTTP 422** · `className: "unprocessable"` · `throw new Unprocessable(message, data?, errors?, hint?)`

The request is well-formed but the data in it isn't valid.

## When Mantle returns it

- Schema validation failed: [`@mantlejs/schema`](/packages/schema/)'s `validate()` hook puts the individual failures in `data.errors`.
- The database can't execute the query as written (Postgres SQLSTATE classes `3D`, `3F`, or `42` other than `42501`), for example an unknown column.

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/unprocessable",
  "title": "Unprocessable",
  "status": 422,
  "detail": "Validation failed",
  "instance": "/users",
  "className": "unprocessable",
  "data": {
    "errors": [
      {
        "path": "/email",
        "message": "Expected string to match 'email' format"
      }
    ]
  },
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "Unprocessable", "message": …, "code": 422, "className": "unprocessable" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Fix the fields listed in `data.errors` (each names the failing path and why) and send the request again.
