---
title: Unavailable
description: "HTTP 503 — A backing service is temporarily unreachable or overloaded."
sidebar:
  order: 12
---

**HTTP 503** · `className: "unavailable"` · `throw new Unavailable(message, data?, errors?, hint?)`

A backing service is temporarily unreachable or overloaded.

## When Mantle returns it

- The database connection failed or was interrupted (Postgres SQLSTATE classes `08` and `57`; MongoDB network and server-selection errors).
- DynamoDB throttled the request (`ProvisionedThroughputExceededException`, `RequestLimitExceeded`).

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/unavailable",
  "title": "Unavailable",
  "status": 503,
  "detail": "Connection terminated unexpectedly",
  "instance": "/users",
  "className": "unavailable",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "Unavailable", "message": …, "code": 503, "className": "unavailable" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Retry with exponential backoff. If it persists, check the database's health and connection settings.
