export class Enum {
  static hasValue<T extends { [key: string]: any }>(EnumType: T, value: any) {
    return Enum.getKeys(EnumType).filter((k) => EnumType[k] === value).length > 0;
  }
  static getKeys<T extends { [key: string]: any }>(EnumType: T) {
    return Object.keys(EnumType).filter((k) => isNaN(Number(k)));
  }
}
