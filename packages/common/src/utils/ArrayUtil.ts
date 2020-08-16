import * as R from "ramda";

export const ArrayUtil = {
  sample<T>(array: T[]) {
    return array[Math.floor(Math.random() * array.length)];
  },
  isNilOrEmpty<T>(array: T[]) {
    return R.isNil(array) || R.isEmpty(array);
  },
};

export function NumberArray(values?: any[]) {
  if (!Array.isArray(values)) {
    return values;
  }
  return values.map((v) => Number(v));
}
