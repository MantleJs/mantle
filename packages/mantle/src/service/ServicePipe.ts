import { ServiceFunction, HookFunction } from "./ServiceHook";
import * as R from "ramda";

/**
 * This is a constructor function that creates a service pipe, which essential reduces the hooks into a single hook when request and response
 * is pipe through each hook.
 *
 * @param {HookFunction[]} hookFunctions - Hook functions used to create the pipe
 *
 * @returns {HookFunction} - a new HookFunction that pipes the list of HookFunction and adds standard hooks to the pipe.
 */
export function ServicePipe(hookFunctions: HookFunction[]): HookFunction {
  return (serviceFunction: ServiceFunction) => {
    return R.reverse(hookFunctions).reduce((svc, hook) => hook(svc), serviceFunction);
  };
}
