import { TooManyRequests } from "./errors.js";
import {
  errorResponseHeaders,
  isBodylessStatus,
  requestIdHeaders,
  resolveClientIp,
  resolveRequestId,
  successResponse,
} from "./transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function headers(values: Record<string, string | string[]>) {
  return (name: string) => values[name];
}

describe("resolveRequestId", () => {
  it("uses a valid X-Request-Id", () => {
    expect(resolveRequestId(headers({ "x-request-id": "req-1" }))).toEqual({ requestId: "req-1", legacy: false });
  });

  it.each([
    ["a UUID", "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"],
    ["an AWS trace header", "Root=1-5759e988-bd862e3fe1be46a994272793"],
    ["base64", "dGVzdA+/x=="],
    ["128 characters", "a".repeat(128)],
  ])("accepts %s", (_label, value) => {
    expect(resolveRequestId(headers({ "x-request-id": value })).requestId).toBe(value);
  });

  it.each([
    ["empty", ""],
    ["spaces", "a b"],
    ["a CRLF injection", "a\r\nSet-Cookie: x=1"],
    ["a log-forging quote", 'a"b'],
    ["129 characters", "a".repeat(129)],
  ])("replaces an invalid value (%s) with a generated UUID", (_label, value) => {
    expect(resolveRequestId(headers({ "x-request-id": value })).requestId).toMatch(UUID);
  });

  it("generates a UUID when no header is present", () => {
    expect(resolveRequestId(headers({}))).toEqual({ requestId: expect.stringMatching(UUID), legacy: false });
  });

  it("falls back to a valid legacy X-Correlation-Id and flags it", () => {
    expect(resolveRequestId(headers({ "x-correlation-id": "old-1" }))).toEqual({ requestId: "old-1", legacy: true });
  });

  it("prefers X-Request-Id over X-Correlation-Id", () => {
    const resolved = resolveRequestId(headers({ "x-request-id": "new-1", "x-correlation-id": "old-1" }));
    expect(resolved).toEqual({ requestId: "new-1", legacy: false });
  });

  it("falls back to X-Correlation-Id when X-Request-Id is invalid", () => {
    const resolved = resolveRequestId(headers({ "x-request-id": "bad id", "x-correlation-id": "old-1" }));
    expect(resolved).toEqual({ requestId: "old-1", legacy: true });
  });

  it("uses the first value of a repeated header", () => {
    expect(resolveRequestId(headers({ "x-request-id": ["first", "second"] })).requestId).toBe("first");
  });
});

describe("requestIdHeaders", () => {
  it("echoes X-Request-Id only for current callers", () => {
    expect(requestIdHeaders({ requestId: "r", legacy: false })).toEqual({ "X-Request-Id": "r" });
  });

  it("also echoes X-Correlation-Id for legacy callers", () => {
    expect(requestIdHeaders({ requestId: "r", legacy: true })).toEqual({
      "X-Request-Id": "r",
      "X-Correlation-Id": "r",
    });
  });
});

describe("resolveClientIp", () => {
  const xff = "198.51.100.9, 203.0.113.7";

  it("returns the peer and ignores X-Forwarded-For by default", () => {
    expect(resolveClientIp("10.0.0.1", xff)).toBe("10.0.0.1");
    expect(resolveClientIp("10.0.0.1", xff, false)).toBe("10.0.0.1");
    expect(resolveClientIp("10.0.0.1", xff, 0)).toBe("10.0.0.1");
  });

  it("returns the leftmost entry with trustProxy: true", () => {
    expect(resolveClientIp("10.0.0.1", xff, true)).toBe("198.51.100.9");
  });

  it("counts hops from the peer with a numeric trustProxy", () => {
    expect(resolveClientIp("10.0.0.1", xff, 1)).toBe("203.0.113.7");
    expect(resolveClientIp("10.0.0.1", xff, 2)).toBe("198.51.100.9");
  });

  it("stops at the leftmost entry when trustProxy exceeds the chain", () => {
    expect(resolveClientIp("10.0.0.1", xff, 10)).toBe("198.51.100.9");
  });

  it("ignores a client-prepended spoof with a numeric trustProxy", () => {
    expect(resolveClientIp("10.0.0.1", "6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("joins repeated X-Forwarded-For headers and skips empty entries", () => {
    expect(resolveClientIp("10.0.0.1", ["198.51.100.9", " , 203.0.113.7"], 1)).toBe("203.0.113.7");
  });

  it("falls back to the peer when X-Forwarded-For is absent", () => {
    expect(resolveClientIp("10.0.0.1", undefined, true)).toBe("10.0.0.1");
  });

  it("counts an unknown peer (Fetch API) as hop 1, matching Node", () => {
    expect(resolveClientIp(undefined, xff, 1)).toBe("203.0.113.7");
    expect(resolveClientIp(undefined, xff, true)).toBe("198.51.100.9");
    expect(resolveClientIp(undefined, xff)).toBeUndefined();
    expect(resolveClientIp(undefined, undefined, true)).toBeUndefined();
  });

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(resolveClientIp("::ffff:127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(resolveClientIp("::1", undefined)).toBe("::1");
  });
});

describe("response helpers", () => {
  it("isBodylessStatus is true for 204 and 304 only", () => {
    expect([200, 201, 204, 304, 404].map(isBodylessStatus)).toEqual([false, false, true, true, false]);
  });

  it("successResponse overrides the default status and reports bodyless statuses", () => {
    expect(successResponse({}, 201)).toEqual({ status: 201, headers: {}, bodyless: false });
    expect(successResponse({ status: 304, headers: { ETag: '"v1"' } }, 200)).toEqual({
      status: 304,
      headers: { ETag: '"v1"' },
      bodyless: true,
    });
  });

  it("errorResponseHeaders merges MantleError.headers over hook headers", () => {
    const err = Object.assign(new TooManyRequests(), { headers: { "Retry-After": "30", "X-A": "error" } });
    expect(errorResponseHeaders({ headers: { RateLimit: "r", "X-A": "hook" } }, err)).toEqual({
      RateLimit: "r",
      "Retry-After": "30",
      "X-A": "error",
    });
  });

  it("errorResponseHeaders ignores non-Mantle errors' headers", () => {
    const err = Object.assign(new Error("boom"), { headers: { "X-A": "leak" } });
    expect(errorResponseHeaders(undefined, err)).toEqual({});
  });
});
