import {
  BadRequest,
  Conflict,
  Forbidden,
  GeneralError,
  MantleError,
  MethodNotAllowed,
  NotAuthenticated,
  NotFound,
  NotImplemented,
  TooManyRequests,
  Unavailable,
  Unprocessable,
} from "./errors.js";

describe("MantleError", () => {
  it("carries code, className, and message", () => {
    const err = new BadRequest("Invalid input");
    expect(err.code).toBe(400);
    expect(err.className).toBe("bad-request");
    expect(err.message).toBe("Invalid input");
    expect(err.name).toBe("BadRequest");
  });

  it("uses default message when none provided", () => {
    expect(new BadRequest().message).toBe("Bad Request");
    expect(new NotFound().message).toBe("Not Found");
  });

  it("attaches optional data and errors fields", () => {
    const err = new BadRequest("Bad", { field: "email" }, ["required"]);
    expect(err.data).toEqual({ field: "email" });
    expect(err.errors).toEqual(["required"]);
  });

  it("omits data and errors from toJSON when not set", () => {
    const json = new NotFound("Missing").toJSON();
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("errors");
  });

  it("includes data and errors in toJSON when set", () => {
    const json = new BadRequest("Bad", { field: "x" }, ["e1"]).toJSON();
    expect(json.data).toEqual({ field: "x" });
    expect(json.errors).toEqual(["e1"]);
  });

  it("toJSON includes name, message, code, className", () => {
    const json = new GeneralError("Boom").toJSON();
    expect(json).toMatchObject({
      name: "GeneralError",
      message: "Boom",
      code: 500,
      className: "general-error",
    });
  });

  it("is instanceof MantleError and its own class", () => {
    const err = new Forbidden("No");
    expect(err).toBeInstanceOf(MantleError);
    expect(err).toBeInstanceOf(Forbidden);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("HTTP status codes", () => {
  const cases: [new () => MantleError, number][] = [
    [BadRequest, 400],
    [NotAuthenticated, 401],
    [Forbidden, 403],
    [NotFound, 404],
    [MethodNotAllowed, 405],
    [Conflict, 409],
    [Unprocessable, 422],
    [TooManyRequests, 429],
    [GeneralError, 500],
    [NotImplemented, 501],
    [Unavailable, 503],
  ];

  it.each(cases)("%s → %i", (Cls, expectedCode) => {
    expect(new Cls().code).toBe(expectedCode);
  });
});
