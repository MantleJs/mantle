import { MantleApplicationImpl } from "./application.js";
import type { MantleApplication } from "./types.js";

export function mantle(): MantleApplication {
  return new MantleApplicationImpl();
}
