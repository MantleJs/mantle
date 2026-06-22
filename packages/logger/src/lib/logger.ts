import type { Logger, MantlePlugin } from "@mantlejs/core";

/** Registers a Logger adapter on the application via app.set('logger', adapter). */
export function logger(adapter: Logger): MantlePlugin {
  return (app) => {
    app.set("logger", adapter);
  };
}
