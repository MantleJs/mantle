export class MantleError extends Error {
  readonly code: number;
  readonly className: string;
  readonly data?: unknown;
  readonly errors?: unknown[];
  /** Actionable guidance for the caller — what to change so the request succeeds. Serialized in toJSON(). */
  readonly hint?: string;

  constructor(message: string, code: number, className: string, data?: unknown, errors?: unknown[], hint?: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.className = className;
    this.data = data;
    this.errors = errors;
    this.hint = hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      name: this.name,
      message: this.message,
      code: this.code,
      className: this.className,
    };
    if (this.data !== undefined) json["data"] = this.data;
    if (this.errors !== undefined) json["errors"] = this.errors;
    if (this.hint !== undefined) json["hint"] = this.hint;
    return json;
  }
}

export class BadRequest extends MantleError {
  constructor(message = "Bad Request", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 400, "bad-request", data, errors, hint);
  }
}

export class NotAuthenticated extends MantleError {
  constructor(message = "Not Authenticated", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 401, "not-authenticated", data, errors, hint);
  }
}

export class Forbidden extends MantleError {
  constructor(message = "Forbidden", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 403, "forbidden", data, errors, hint);
  }
}

export class NotFound extends MantleError {
  constructor(message = "Not Found", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 404, "not-found", data, errors, hint);
  }
}

export class MethodNotAllowed extends MantleError {
  constructor(message = "Method Not Allowed", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 405, "method-not-allowed", data, errors, hint);
  }
}

export class Conflict extends MantleError {
  constructor(message = "Conflict", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 409, "conflict", data, errors, hint);
  }
}

export class Unprocessable extends MantleError {
  constructor(message = "Unprocessable Entity", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 422, "unprocessable", data, errors, hint);
  }
}

export class TooManyRequests extends MantleError {
  constructor(message = "Too Many Requests", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 429, "too-many-requests", data, errors, hint);
  }
}

export class GeneralError extends MantleError {
  constructor(message = "General Error", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 500, "general-error", data, errors, hint);
  }
}

export class NotImplemented extends MantleError {
  constructor(message = "Not Implemented", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 501, "not-implemented", data, errors, hint);
  }
}

export class Unavailable extends MantleError {
  constructor(message = "Service Unavailable", data?: unknown, errors?: unknown[], hint?: string) {
    super(message, 503, "unavailable", data, errors, hint);
  }
}
