---
title: TooManyRequests
description: "HTTP 429 — The caller has sent too many requests in the current window."
sidebar:
  order: 9
---

**HTTP 429** · `className: "too-many-requests"` · `throw new TooManyRequests(message, data?, errors?, hint?)`

The caller has sent too many requests in the current window.

## When Mantle returns it

- A rate-limit hook rejected the call. The response's `Retry-After` header says how many seconds to wait, and the `RateLimit` and `RateLimit-Policy` headers describe the limit.

## Example response

As [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), the default:

```json
{
  "type": "https://mantlejs.com/errors/too-many-requests",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded",
  "instance": "/users",
  "className": "too-many-requests",
  "hint": "Retry after the number of seconds in the Retry-After header",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the transport option `errors: "mantle"`, the same error is `{ "name": "TooManyRequests", "message": …, "code": 429, "className": "too-many-requests" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Wait the number of seconds in `Retry-After`, then retry. Spread requests out, or batch them through `POST /batch`.
