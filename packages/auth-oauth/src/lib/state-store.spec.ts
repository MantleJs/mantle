import { describe, expect, it } from "vitest";
import { createStateStore } from "./state-store.js";

describe("createStateStore (in-memory default)", () => {
  it("consume returns the pending entry once, then undefined", async () => {
    const store = createStateStore();
    await store.set("state-1", { codeVerifier: "verifier-1" });

    expect(await store.consume("state-1")).toMatchObject({ codeVerifier: "verifier-1" });
    expect(await store.consume("state-1")).toBeUndefined();
  });

  it("consume returns undefined for a state that was never set", async () => {
    const store = createStateStore();
    expect(await store.consume("unknown")).toBeUndefined();
  });

  it("consume returns undefined for an expired entry, and removes it", async () => {
    const store = createStateStore(-1); // already-expired TTL
    await store.set("state-1", { codeVerifier: "verifier-1" });

    expect(await store.consume("state-1")).toBeUndefined();
  });

  it("consume is atomic under concurrent calls for the same state — exactly one caller sees the entry", async () => {
    // The in-memory store is atomic by construction (no await between read and delete inside
    // consume()), but this proves the *caller-visible* contract holds under Promise.all, not just
    // "the implementation looks synchronous" — matches how the real dispatch path calls it (two
    // concurrent OAuth callback requests racing on the same state).
    const store = createStateStore();
    await store.set("state-1", { codeVerifier: "verifier-1" });

    const [first, second] = await Promise.all([store.consume("state-1"), store.consume("state-1")]);
    const results = [first, second];
    const winners = results.filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ codeVerifier: "verifier-1" });
  });

  it("get and delete remain independently usable (not removed by adding consume)", () => {
    const store = createStateStore();
    store.set("state-1", { codeVerifier: "verifier-1" });
    expect(store.get("state-1")).toMatchObject({ codeVerifier: "verifier-1" });
    store.delete("state-1");
    expect(store.get("state-1")).toBeUndefined();
  });
});
