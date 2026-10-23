import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as errors from "./errors.js";
import {
  BadRequest,
  Conflict,
  GeneralError,
  MantleError,
  PreconditionFailed,
  TooManyRequests,
  Unprocessable,
} from "./errors.js";
import { errorResponse, toProblemDetails } from "./problem-details.js";

class TeapotError extends MantleError {
  constructor() {
    super("I'm a teapot", 418, "teapot");
  }
}

describe("toProblemDetails", () => {
  it("maps a MantleError's fields onto RFC 9457 members plus Mantle's extensions", () => {
    const err = new Unprocessable("Validation failed", { form: "signup" }, [{ path: "/email" }], "Send a valid email");
    expect(toProblemDetails(err, { instance: "/users", requestId: "r-1" })).toEqual({
      type: "https://mantlejs.com/errors/unprocessable",
      title: "Unprocessable",
      status: 422,
      detail: "Validation failed",
      instance: "/users",
      requestId: "r-1",
      className: "unprocessable",
      data: { form: "signup" },
      errors: [{ path: "/email" }],
      hint: "Send a valid email",
    });
  });

  it.each([
    [new BadRequest(), "bad-request", "Bad Request"],
    [new Conflict(), "conflict", "Conflict"],
    [new PreconditionFailed(), "precondition-failed", "Precondition Failed"],
    [new TooManyRequests(), "too-many-requests", "Too Many Requests"],
    [new GeneralError(), "general-error", "General Error"],
  ])("gives %s a mantlejs.com type and its class name in words as title", (err, className, title) => {
    const problem = toProblemDetails(err);
    expect(problem.type).toBe(`https://mantlejs.com/errors/${className}`);
    expect(problem.title).toBe(title);
  });

  it("uses about:blank for an app-defined error class, which has no docs page", () => {
    expect(toProblemDetails(new TeapotError())).toMatchObject({
      type: "about:blank",
      title: "Teapot Error",
      status: 418,
    });
  });

  it("omits optional members that aren't set", () => {
    expect(toProblemDetails(new BadRequest("nope"))).toEqual({
      type: "https://mantlejs.com/errors/bad-request",
      title: "Bad Request",
      status: 400,
      detail: "nope",
      className: "bad-request",
    });
  });

  it("maps a non-MantleError to a bare 500 without its message", () => {
    const problem = toProblemDetails(new Error("password=hunter2"), { requestId: "r-2" });
    expect(problem).toEqual({
      type: "https://mantlejs.com/errors/general-error",
      title: "General Error",
      status: 500,
      requestId: "r-2",
    });
  });

  it("never includes MantleError.headers", () => {
    const err = Object.assign(new TooManyRequests(), { headers: { "Retry-After": "30" } });
    expect(toProblemDetails(err)).not.toHaveProperty("headers");
  });
});

describe("errorResponse", () => {
  it('defaults to the "mantle" shape as application/json', () => {
    expect(errorResponse(new BadRequest("nope"))).toEqual({
      status: 400,
      contentType: "application/json",
      body: { name: "BadRequest", message: "nope", code: 400, className: "bad-request" },
    });
  });

  it('serves "problem+json" as application/problem+json', () => {
    const response = errorResponse(new BadRequest("nope"), "problem+json", { instance: "/x" });
    expect(response.status).toBe(400);
    expect(response.contentType).toBe("application/problem+json");
    expect(response.body).toMatchObject({ status: 400, detail: "nope", instance: "/x" });
  });

  it('keeps today\'s "mantle" 500 for a non-MantleError', () => {
    expect(errorResponse("boom")).toEqual({
      status: 500,
      contentType: "application/json",
      body: { name: "GeneralError", message: "An unexpected error occurred", code: 500, className: "general-error" },
    });
  });
});

describe("Problem Details type URIs", () => {
  // Every built-in error class exported from this package, found by walking the module rather than listing them,
  // so a new class can't be added without a docs page.
  const builtIns = (Object.values(errors) as unknown[]).filter(
    (value): value is new () => MantleError =>
      typeof value === "function" && value !== MantleError && value.prototype instanceof MantleError,
  );

  it("covers every built-in error class", () => {
    expect(builtIns.length).toBeGreaterThanOrEqual(12);
  });

  it.each(builtIns.map((Cls) => [new Cls().name, new Cls()] as const))(
    "%s links to an existing mantlejs.com/errors page",
    (_name, err) => {
      const { type } = toProblemDetails(err);
      expect(type).toBe(`https://mantlejs.com/errors/${err.className}`);
      const page = fileURLToPath(
        new URL(`../../../../website/src/content/docs/errors/${err.className}.md`, import.meta.url),
      );
      expect(existsSync(page)).toBe(true);
    },
  );
});
