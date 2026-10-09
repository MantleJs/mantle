import { MantleClientError } from "@mantlejs/client";
import { describe, expect, it } from "vitest";
import { toFormErrors } from "@/lib/mantle-errors";

describe("toFormErrors", () => {
  it("maps @mantlejs/schema validation errors onto field names", () => {
    const error = new MantleClientError("Validation failed", 422, "Unprocessable", {
      data: {
        errors: [
          { field: "/email", message: "must match format email" },
          { field: "/address/city", message: "is required" },
          { field: "/email", message: "second message ignored" },
        ],
      },
    });
    expect(toFormErrors(error)).toEqual({
      fields: { email: "must match format email", "address.city": "is required" },
    });
  });

  it("turns any other MantleClientError into a form-level message", () => {
    expect(toFormErrors(new MantleClientError("Email already exists", 409, "Conflict"))).toEqual({
      form: "Email already exists",
      fields: {},
    });
  });

  it("falls back to a per-class message when the server sent none", () => {
    expect(toFormErrors(new MantleClientError("", 401, "NotAuthenticated")).form).toBe("Invalid credentials.");
  });

  it("treats a non-Mantle error as a connectivity problem", () => {
    expect(toFormErrors(new TypeError("Failed to fetch")).form).toMatch(/Couldn't reach the server/);
  });
});
