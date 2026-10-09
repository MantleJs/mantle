import { MantleClientError } from "@mantlejs/client";

/** A Mantle error split into what a form can show: one form-level message plus per-field messages. */
export interface FormErrors {
  /** Form-level message (an `Alert`), or `undefined` when every problem maps to a field. */
  form?: string;
  /** Field name → message, shaped for React Aria `<Form validationErrors>`. */
  fields: Record<string, string>;
}

const FALLBACK_MESSAGES: Record<string, string> = {
  NotAuthenticated: "Invalid credentials.",
  Forbidden: "You don't have permission to do that.",
  Conflict: "That already exists.",
  GeneralError: "Something went wrong on the server. Please try again.",
};

/**
 * Maps any error thrown by `@mantlejs/client` onto form state. `Unprocessable` errors from
 * `@mantlejs/schema`'s `validate()` hook carry `data.errors: [{ field: "/email", message }]` —
 * those become field errors (`"/email"` → `"email"`, `"/address/city"` → `"address.city"`);
 * anything else becomes a form-level message. A non-Mantle error (e.g. `fetch` failing because
 * the server is unreachable) gets a generic connectivity message rather than a raw `TypeError`.
 */
export function toFormErrors(error: unknown): FormErrors {
  if (!(error instanceof MantleClientError)) {
    return { form: "Couldn't reach the server. Check your connection and try again.", fields: {} };
  }
  const fields: Record<string, string> = {};
  for (const entry of validationEntries(error.data)) {
    const name = entry.field.replace(/^\//, "").replace(/\//g, ".");
    if (name && !(name in fields)) fields[name] = entry.message;
  }
  if (Object.keys(fields).length > 0) return { fields };
  return { form: error.message || FALLBACK_MESSAGES[error.name] || "Request failed.", fields };
}

function validationEntries(data: unknown): Array<{ field: string; message: string }> {
  if (data === null || typeof data !== "object") return [];
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const { field, message } = entry as { field?: unknown; message?: unknown };
    return typeof field === "string" && typeof message === "string" ? [{ field, message }] : [];
  });
}
