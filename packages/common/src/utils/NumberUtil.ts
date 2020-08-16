export function tryParseInt(value: any, defaultValue = 0, radix = 10) {
  try {
    if (typeof value !== "number") {
      const num = parseInt(value, radix);
      if (!isNaN(num)) return num;
    } else {
      return value;
    }
  } catch (err) {
    // ignore
  }
  return defaultValue;
}

export const NumberUtil = {
  tryParseInt,
};
