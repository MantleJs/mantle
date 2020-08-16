import * as R from "ramda";
import { appendFileSync } from "fs";
/**
 * Used to test if a value is an object
 *
 * @param value - test to test if is an object
 */
export function isObject<T>(value: null | undefined | T): boolean {
  return typeof value === "object" && value !== null;
}

export function isReadOnlyProperty(obj: any, propName: string) {
  if (!isObject(obj)) return false;
  const desc = Reflect.getOwnPropertyDescriptor(isClass(obj) ? Reflect.getPrototypeOf(obj) : obj, propName);

  return !!(desc && desc.get && !desc.set);
}

export function isClass(obj: any) {
  if (!obj) return false;

  const isCtorClass = obj.constructor && obj.constructor.toString().substring(0, 5) === "class";
  if (obj.prototype === undefined) {
    return isCtorClass;
  }
  const isPrototypeCtorClass = obj.prototype.constructor && obj.prototype.constructor.toString && obj.prototype.constructor.toString().substring(0, 5) === "class";
  return isCtorClass || isPrototypeCtorClass;
}

export const ObjectUtil = {
  isClass,
  isReadOnlyProperty,
  /**
   * Copies all props from source object to destination object
   *
   * @param {object} src - the source object
   * @param {object} dest - the destination object
   */
  copyTo<T = any>(src: T, dest: any): T {
    if (src) {
      for (const [k, v] of Object.entries(src)) {
        if (!isReadOnlyProperty(dest, k)) {
          dest[k] = v;
        }
      }
    }
    return dest as T;
  },
  isObject,
  getFirstPropValue<T = any>(propNames: string[] | string[][], obj: any /*options*/): T {
    let value: T;
    /** @todo implement this if needed */
    /* const { recursive = true, caseInsensitive=true }  = options; */
    if (isObject(obj)) {
      for (const name of propNames) {
        value = R.path([].concat(name), obj);
        if (typeof value !== "undefined") break;
      }
    }

    return value;
  },
};
