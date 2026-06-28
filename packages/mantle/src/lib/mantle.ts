import { MantleApplicationImpl } from "./application.js";
import type { MantleApplication, MantleOptions } from "./types.js";

export function mantle(options?: MantleOptions): MantleApplication {
  return new MantleApplicationImpl(options);
}
