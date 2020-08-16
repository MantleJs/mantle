/**
 * Used to test if a string is empty, null, or undefined
 *
 * @param {string|null|undefined} str - a string value to test if it is empty, null, or undefined
 *
 * @returns {boolean} returns true if str is null, empty string, or undefined.
 */
export function isStringEmptyUndefinedOrNull(str?: string | null): boolean {
  return str === null || typeof str === "undefined" || str.trim() === "";
}

export function splice(str: string, index: number, count: number, value?: string) {
  if (index < 0) {
    index = str.length + index;
    if (index < 0) {
      index = 0;
    }
  }

  return str.slice(0, index) + (value || "") + str.slice(index + count);
}

export const StringUtil = {
  isStringEmptyUndefinedOrNull,
  splice,
};
