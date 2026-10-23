---
title: PreconditionFailed
description: "HTTP 412 — A condition the caller set on the request isn't met."
sidebar:
  order: 7
---

**HTTP 412** · `className: "precondition-failed"` · `throw new PreconditionFailed(message, data?, errors?, hint?)`

A condition the caller set on the request isn't met.

## When Mantle returns it

- An `If-Match` header names an ETag that no longer matches the record: someone else changed it since you read it.

## Example response

With the transport option `errors: "problem+json"` ([RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "https://mantlejs.com/errors/precondition-failed",
  "title": "Precondition Failed",
  "status": 412,
  "detail": "The resource has changed since it was read",
  "instance": "/users/42",
  "className": "precondition-failed",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

With the default `errors: "mantle"`, the same error is `{ "name": "PreconditionFailed", "message": …, "code": 412, "className": "precondition-failed" }`, plus `data`, `errors`, and `hint` when set.

## How to fix it

Fetch the record again to get its current ETag, re-apply your change, and retry with the new `If-Match` value.
