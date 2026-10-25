import { describe, expect, it } from "vitest";
import { parseTraceparent, parseTracestate, resolveTraceHeaders } from "./trace-context.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";
const VALID = `00-${TRACE_ID}-${SPAN_ID}-01`;

function headers(values: Record<string, string | string[]>): (name: string) => string | string[] | undefined {
  return (name) => values[name];
}

describe("parseTraceparent", () => {
  it("parses a valid version 00 header", () => {
    expect(parseTraceparent(VALID)).toEqual({
      version: "00",
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      flags: "01",
      sampled: true,
    });
  });

  it("reads the sampled bit from the flags", () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)?.sampled).toBe(false);
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-03`)?.sampled).toBe(true);
  });

  it("returns undefined when absent", () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
  });

  it.each([
    ["empty", ""],
    ["garbage", "not-a-traceparent"],
    ["upper-case hex", `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ["short trace ID", `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`],
    ["short span ID", `00-${TRACE_ID}-${SPAN_ID.slice(1)}-01`],
    ["all-zero trace ID", `00-${"0".repeat(32)}-${SPAN_ID}-01`],
    ["all-zero span ID", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["version ff", `ff-${TRACE_ID}-${SPAN_ID}-01`],
    ["version 00 with trailing data", `${VALID}-extra`],
    ["a future version with trailing data not separated by a dash", `cc-${TRACE_ID}-${SPAN_ID}-01extra`],
    ["two joined headers", `${VALID}, ${VALID}`],
  ])("drops a malformed header: %s", (_name, value) => {
    expect(parseTraceparent(value)).toBeUndefined();
  });

  it("reads a future version by its first four fields", () => {
    expect(parseTraceparent(`cc-${TRACE_ID}-${SPAN_ID}-01-what-comes-next`)).toMatchObject({
      version: "cc",
      traceId: TRACE_ID,
      spanId: SPAN_ID,
    });
  });
});

describe("parseTracestate", () => {
  it("keeps a valid list, dropping whitespace and empty members", () => {
    expect(parseTracestate(" rojo=00f067aa0ba902b7 ,, congo=t61rcWkgMzE")).toBe(
      "rojo=00f067aa0ba902b7,congo=t61rcWkgMzE",
    );
  });

  it("accepts multi-tenant keys", () => {
    expect(parseTracestate("tenant1@vendor=abc")).toBe("tenant1@vendor=abc");
  });

  it.each([
    ["no equals sign", "rojo"],
    ["empty key", "=value"],
    ["upper-case key", "Rojo=1"],
    ["value with a control character", "rojo=a\tb"],
    ["empty value", "rojo="],
    ["value with an equals sign", "rojo=a=b"],
    ["duplicate key", "rojo=1,rojo=2"],
    ["only empty members", " , "],
  ])("drops a malformed list: %s", (_name, value) => {
    expect(parseTracestate(value)).toBeUndefined();
  });

  it("drops a list of more than 32 members", () => {
    const members = Array.from({ length: 33 }, (_, i) => `k${i}=v`);
    expect(parseTracestate(members.slice(0, 32).join(","))).toBeDefined();
    expect(parseTracestate(members.join(","))).toBeUndefined();
  });
});

describe("resolveTraceHeaders", () => {
  it("returns both headers when valid", () => {
    expect(resolveTraceHeaders(headers({ traceparent: VALID, tracestate: "rojo=1" }))).toEqual({
      traceparent: VALID,
      tracestate: "rojo=1",
    });
  });

  it("returns nothing when traceparent is absent, even with a tracestate", () => {
    expect(resolveTraceHeaders(headers({ tracestate: "rojo=1" }))).toEqual({});
  });

  it("drops tracestate along with a malformed traceparent", () => {
    expect(resolveTraceHeaders(headers({ traceparent: "junk", tracestate: "rojo=1" }))).toEqual({});
  });

  it("keeps traceparent when only tracestate is malformed", () => {
    expect(resolveTraceHeaders(headers({ traceparent: VALID, tracestate: "Bad=1" }))).toEqual({ traceparent: VALID });
  });

  it("treats repeated traceparent headers as malformed", () => {
    expect(resolveTraceHeaders(headers({ traceparent: [VALID, VALID] }))).toEqual({});
  });

  it("joins repeated tracestate headers", () => {
    expect(resolveTraceHeaders(headers({ traceparent: VALID, tracestate: ["rojo=1", "congo=2"] }))).toEqual({
      traceparent: VALID,
      tracestate: "rojo=1,congo=2",
    });
  });

  it("re-serializes a future version as 00", () => {
    expect(resolveTraceHeaders(headers({ traceparent: `cc-${TRACE_ID}-${SPAN_ID}-01-more` }))).toEqual({
      traceparent: VALID,
    });
  });
});
