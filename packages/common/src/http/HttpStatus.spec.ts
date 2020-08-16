import { HttpStatus } from ".";

describe("HttpStatus", () => {
  it("should return 200 when HttpStatus.OK is called", () => {
    expect(HttpStatus.OK).toEqual(200);
  });
  it("should return 201 when HttpStatus.CREATED is called", () => {
    expect(HttpStatus.CREATED).toEqual(201);
  });
  it("should return 202 when HttpStatus.ACCEPTED is called", () => {
    expect(HttpStatus.ACCEPTED).toEqual(202);
  });
  it("should return 204 when HttpStatus.NO_CONTENT is called", () => {
    expect(HttpStatus.NO_CONTENT).toEqual(204);
  });
  it("should return 400 when HttpStatus.BAD_REQUEST is called", () => {
    expect(HttpStatus.BAD_REQUEST).toEqual(400);
  });
  it("should return 401 when HttpStatus.UNAUTHORIZED is called", () => {
    expect(HttpStatus.UNAUTHORIZED).toEqual(401);
  });
  it("should return 403 when HttpStatus.FORBIDDEN is called", () => {
    expect(HttpStatus.FORBIDDEN).toEqual(403);
  });
  it("should return 404 when HttpStatus.NOT_FOUND is called", () => {
    expect(HttpStatus.NOT_FOUND).toEqual(404);
  });
  it("should return 409 when HttpStatus.CONFLICT is called", () => {
    expect(HttpStatus.CONFLICT).toEqual(409);
  });
  it("should return 419 when HttpStatus.AUTH_TIMEOUT is called", () => {
    expect(HttpStatus.AUTH_TIMEOUT).toEqual(419);
  });
  it("should return 500 when HttpStatus.INTERNAL_SERVER_ERROR is called", () => {
    expect(HttpStatus.INTERNAL_SERVER_ERROR).toEqual(500);
  });
});
