import { ObjectUtil } from "@mantlejs/common";

export enum ServiceResponseType {
  ERROR = -1,
  UNKNOWN = 0,
  SUCCESS = 1,
  ACCEPTED = 2,
}

export class ServiceResponse<T extends number = ServiceResponseType> {
  constructor(args: Partial<ServiceResponse<T>> = {}, freeze = true) {
    ObjectUtil.copyTo(args, this);

    if (typeof this.type === "undefined") this.type = ServiceResponseType.UNKNOWN as T;
    if (freeze) {
      this.frozen = true;
      Object.freeze(this);
    } else {
      this.frozen = false;
    }
  }

  public frozen: boolean;
  public type: T;
  public payload?: any;

  public get success(): boolean {
    return this.type !== ServiceResponseType.ERROR && this.type !== ServiceResponseType.UNKNOWN;
  }
}
