import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom has no CSS namespace; React Aria collections use CSS.escape to look up item elements.
if (typeof globalThis.CSS === "undefined" || typeof globalThis.CSS.escape !== "function") {
  const escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  Object.defineProperty(globalThis, "CSS", { value: { ...globalThis.CSS, escape }, configurable: true });
}

// jsdom has no canvas; axe probes one for icon-ligature detection and handles a null context fine.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
