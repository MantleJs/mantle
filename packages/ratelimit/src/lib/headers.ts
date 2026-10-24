import { BadRequest } from "@mantlejs/mantle";

/*
 * The `RateLimit` and `RateLimit-Policy` header formats from
 * [draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
 * (May 2026, not yet an RFC). Both are Structured Field Lists whose members are a String item (the policy name) with
 * parameters. Everything that depends on the draft's syntax lives here, so a change in the draft is one edit
 * (PRD Decision #4).
 */

export const RATE_LIMIT_HEADER = "RateLimit";
export const RATE_LIMIT_POLICY_HEADER = "RateLimit-Policy";

/**
 * Policy names Mantle accepts: a short token. The draft allows any Structured Field String, but a name that needs no
 * escaping, and contains no `,` or `;`, keeps both the headers and the store keys unambiguous.
 */
const POLICY_NAME = /^[A-Za-z0-9._:-]{1,64}$/;

export function assertPolicyName(name: string): void {
  if (!POLICY_NAME.test(name)) {
    throw new BadRequest(
      `rateLimit() policy name ${JSON.stringify(name)} is invalid`,
      undefined,
      undefined,
      "Use 1–64 characters from A-Z, a-z, 0-9, '.', '_', ':', and '-'.",
    );
  }
}

/** `"default";q=100;w=60` — the quota (`q`) a policy allows per window of `w` seconds. */
export function policyItem(name: string, quota: number, windowSeconds: number): string {
  return `"${name}";q=${quota};w=${windowSeconds}`;
}

/** `"default";r=42;t=18` — the quota remaining (`r`) under a policy, and whole seconds until it resets (`t`). */
export function limitItem(name: string, remaining: number, resetSeconds: number): string {
  return `"${name}";r=${Math.max(0, remaining)};t=${Math.max(0, Math.ceil(resetSeconds))}`;
}

/**
 * Add `item` to a List-valued header, replacing any member for the same policy, so several `rateLimit()` hooks on one
 * call produce one header with a member each rather than one header per hook.
 */
export function mergeListItem(existing: string | undefined, item: string): string {
  const nameOf = (member: string): string => member.slice(0, member.indexOf(";"));
  const kept = (existing ?? "")
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member.length > 0 && nameOf(member) !== nameOf(item));
  return [...kept, item].join(", ");
}
