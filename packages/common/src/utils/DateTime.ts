const reValidDateFormat = /([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])([ T])([0-9]{2}):([0-9]{2})(:[0-9]{2}(.[0-9]{1,6})?)?(Z)?/;

/**
 * This is used to create a Date object from a UTC date time string.
 *
 * NOTE: The date time string is expected to be in one of the ISO formats below with an optional Z suffix:
 *
 * YYYY-MM-DD HH:MM
 * YYYY-MM-DD HH:MM:SS
 * YYYY-MM-DD HH:MM:SS.SSS
 * YYYY-MM-DDTHH:MM
 * YYYY-MM-DDTHH:MM:SS
 * YYYY-MM-DDTHH:MM:SS.SSS
 *
 * @param {string} datetime - A date time string that is expected to UTC/Zulu date and time
 *
 * @return {Date} - A newly mented Date object
 */
export function convertDateTimeStringToDate(datetime: any): Date {
  if (typeof datetime !== "string") return datetime;
  datetime = datetime.trim();
  if (!reValidDateFormat.test(datetime)) throw new Error("Invalid date formate");
  return new Date(`${datetime}${datetime.endsWith("Z") ? "" : "Z"}`);
}

/**
 * This method is used to convert the given datetime fields specified in the fields parameter from a UTC date time string to a Date object.
 *
 * NOTE: The date time string is expected to be in one of the ISO formats below with an optional Z suffix:
 *
 * YYYY-MM-DD HH:MM
 * YYYY-MM-DD HH:MM:SS
 * YYYY-MM-DD HH:MM:SS.SSS
 * YYYY-MM-DDTHH:MM
 * YYYY-MM-DDTHH:MM:SS
 * YYYY-MM-DDTHH:MM:SS.SSS
 *
 * @param {string[]} fields - An array datetime field names in the record to convert to a Date object(NOTE: date times are expected to UTC/Zulu time).
 *
 * @return {T} - The record with the given date fields to convert to Date objects.
 */
export function convertDateTimeFieldsToDate<T extends any, K extends keyof T>(fields: K[], record: T): T {
  if (typeof record !== "object") return record;
  if (!Array.isArray(fields)) return record;

  fields.forEach((k) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    if (typeof record[k] === "string") record[k] = convertDateTimeStringToDate(record[k]);
  });

  return record;
}

export function getDaysBetweenDates(date1: Date, date2: Date) {
  return convertMsToDays(date2.getTime() - date1.getTime());
}

export function getDaysRemainingToDate(date: Date) {
  const days = getDaysBetweenDates(new Date(), date);
  return days < 0 ? 0 : days;
}

export function convertMsToDays(ms: number): number {
  return ms / (1000 * 3600 * 24);
}
export const DateTime = {
  toDate: convertDateTimeStringToDate,
  convertFieldsToDate: convertDateTimeFieldsToDate,
  convertMsToDays,
  getDaysBetween: getDaysBetweenDates,
  getDaysRemaining: getDaysRemainingToDate,
};
