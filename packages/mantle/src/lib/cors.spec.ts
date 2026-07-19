import { describe, expect, it } from "vitest";
import { resolveCorsOrigin } from "./cors.js";

describe("resolveCorsOrigin", () => {
  it("reflects the request origin when unset (default true)", () => {
    expect(resolveCorsOrigin(undefined, "https://app.example.com")).toBe("https://app.example.com");
  });

  it("reflects the request origin when origin is true", () => {
    expect(resolveCorsOrigin(true, "https://app.example.com")).toBe("https://app.example.com");
  });

  it("falls back to '*' when origin is true but no Origin header is present", () => {
    expect(resolveCorsOrigin(true, undefined)).toBe("*");
  });

  it("disallows every origin when origin is false", () => {
    expect(resolveCorsOrigin(false, "https://app.example.com")).toBeUndefined();
  });

  it("returns a fixed string unconditionally", () => {
    expect(resolveCorsOrigin("https://app.example.com", "https://other.example.com")).toBe(
      "https://app.example.com",
    );
  });

  it("allows an origin present in an allow-list", () => {
    expect(resolveCorsOrigin(["https://a.example.com", "https://b.example.com"], "https://b.example.com")).toBe(
      "https://b.example.com",
    );
  });

  it("disallows an origin missing from an allow-list", () => {
    expect(resolveCorsOrigin(["https://a.example.com"], "https://evil.example.com")).toBeUndefined();
  });

  it("disallows when the allow-list is set but no Origin header is present", () => {
    expect(resolveCorsOrigin(["https://a.example.com"], undefined)).toBeUndefined();
  });

  it("delegates to a custom function", () => {
    const origin = (requestOrigin: string | undefined) => requestOrigin === "https://trusted.example.com";
    expect(resolveCorsOrigin(origin, "https://trusted.example.com")).toBe("https://trusted.example.com");
    expect(resolveCorsOrigin(origin, "https://untrusted.example.com")).toBeUndefined();
  });

  it("allows a custom function to return a different origin string", () => {
    expect(resolveCorsOrigin(() => "https://rewritten.example.com", "https://app.example.com")).toBe(
      "https://rewritten.example.com",
    );
  });
});
