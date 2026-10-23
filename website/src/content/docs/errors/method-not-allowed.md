---
title: MethodNotAllowed
description: "HTTP 405 — The service exists but doesn't offer this method."
sidebar:
  order: 5
---

**HTTP 405** · `className: "method-not-allowed"` · `throw new MethodNotAllowed(message, data?, errors?, hint?)`

The service exists but doesn't offer this method.

## When Mantle returns it

- The method isn't in the `methods` list the service was registered with (`app.use(path, service, { methods })`).
- The service object doesn't implement the method.

## Example response

With the transport option `errors: "problem+json"` ([RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "https://mantlejs.com/errors/method-not-allowed",
  "title": "Method Not Allowed",
  "status": 405,
  "detail": "Method 'remove' is not allowed on service 'audit-logs'",
  "instance": "/users",
  "className": "method-not-allowed",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the default `errors: "mantle"`, the same error is `{ "name": "MethodNotAllowed", "message": …, "code": 405, "className": "method-not-allowed" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Call one of the methods the service registers. `GET /_services` (when introspection is enabled) lists them.
