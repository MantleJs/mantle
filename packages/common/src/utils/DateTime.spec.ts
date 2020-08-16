/* eslint-disable @typescript-eslint/ban-ts-comment */
import { DateTime } from "./DateTime";

describe("DateTime", () => {
  describe("toDate", () => {
    describe("when the string is an invalid date string", () => {
      it("should throw an exception", () => {
        expect(() => DateTime.toDate("Invalid")).toThrow();
      });
    });
    describe("when the string is valid date format but not in on of the expected formats", () => {
      it("should throw an exception", () => {
        expect(() => DateTime.toDate("Wed Jun 03 2020 17:43:37 GMT-0700 (Pacific Daylight Time)")).toThrow();
      });
    });
    describe("when the string date time format is YYYY-MM-DD HH:MM", () => {
      let date: Date;
      beforeAll(() => {
        date = DateTime.toDate("2020-06-03 19:17");
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe("2020-06-03T19:17:00.000Z");
      });
    });
    describe("when the string date time format is YYYY-MM-DD HH:MM:SS", () => {
      let date: Date;
      beforeAll(() => {
        date = DateTime.toDate("2020-06-03 19:17:00");
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe("2020-06-03T19:17:00.000Z");
      });
    });
    describe("when the string date time format is YYYY-MM-DD HH:MM:SS.SSS", () => {
      let date: Date;
      beforeAll(() => {
        date = DateTime.toDate("2020-06-03 19:17:00.333");
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe("2020-06-03T19:17:00.333Z");
      });
    });
    describe("when the string date time format is YYYY-MM-DDTHH:MM", () => {
      let date: Date;
      beforeAll(() => {
        date = DateTime.toDate("2020-06-03T19:17");
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe("2020-06-03T19:17:00.000Z");
      });
    });
    describe("when the string date time format is YYYY-MM-DDTHH:MM:SS", () => {
      let date: Date;
      beforeAll(() => {
        date = DateTime.toDate("2020-06-03T19:17:00");
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe("2020-06-03T19:17:00.000Z");
      });
    });
    describe("when the string date time format is YYYY-MM-DDTHH:MM:SS.SSS", () => {
      let date: Date;
      beforeAll(() => {
        date = DateTime.toDate("2020-06-03T19:17:00.333");
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe("2020-06-03T19:17:00.333Z");
      });
    });
    describe("when the string date time format is YYYY-MM-DDTHH:MM:SS.SSSZ", () => {
      let date: Date;
      const now = new Date();
      beforeAll(() => {
        // date = DateTime.toDate("2020-06-03 19:17:00");
        date = DateTime.toDate(now.toISOString());
      });
      it("should return a Date object with the expected UTC date and time", () => {
        expect(date.toISOString()).toBe(now.toISOString());
      });
    });
  });
  describe("convertFieldsToDate", () => {
    const record = { updatedAt: "2020-06-03 19:17", createdAt: "2020-06-03 19:17", prop1: "p1", prop2: "p2" };

    it("should return the value of the datetime parameter when the record is not an object", () => {
      expect(DateTime.convertFieldsToDate(["updatedAt", "createdAt"], undefined)).toBeUndefined();
    });
    it("should return the record when the fields array is not an array", () => {
      expect(DateTime.convertFieldsToDate(undefined, record)).toStrictEqual(record);
    });
    describe("when passed a valid fields and record", () => {
      it("should convert all fields in the fields parameters to a Date object", () => {
        // @ts-ignore
        expect(DateTime.convertFieldsToDate(["updatedAt", "createdAt", "notValidField"], record)).toStrictEqual({
          ...record,
          updatedAt: DateTime.toDate(record.updatedAt),
          createdAt: DateTime.toDate(record.createdAt),
        });
      });
    });
  });
  describe("convertMsDays", () => {
    it("should return the expected days", () => {
      expect(DateTime.convertMsToDays(5 * 24 * 60 * 60 * 1000)).toEqual(5);
    });
  });
  describe("getDaysBetween", () => {
    it("should return a positive days when the 2nd date is a later date", () => {
      expect(DateTime.getDaysBetween(new Date(), new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))).toEqual(5);
    });
    it("should return a negative days when the 2nd date is a earlier date", () => {
      expect(DateTime.getDaysBetween(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), new Date())).toEqual(-5);
    });
  });
  describe("getDaysRemaining", () => {
    it("should return a positive days when the date is in the future", () => {
      expect(Math.round(DateTime.getDaysRemaining(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)))).toEqual(5);
    });
    it("should return a 0 days when the date is in the past", () => {
      expect(DateTime.getDaysRemaining(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000))).toEqual(0);
    });
  });
});
