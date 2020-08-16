import { ObjectUtil } from "@mantlejs/common";

export const SERVICE_RESPONSE_ERROR_TYPE = -1;
export const SERVICE_RESPONSE_UNKNOWN_TYPE = 0;
export const SERVICE_RESPONSE_SUCCESS_TYPE = 1;

export enum ServiceResponseType {
  ERROR = SERVICE_RESPONSE_ERROR_TYPE,
  UNKNOWN = SERVICE_RESPONSE_UNKNOWN_TYPE,
  SUCCESS = SERVICE_RESPONSE_SUCCESS_TYPE,
  QUEUED = 2,
  CREATED = 3,
}

export class ServiceResponse<T extends number = ServiceResponseType> {
  constructor(args: Partial<ServiceResponse<T>> = {}, freeze = true) {
    ObjectUtil.copyTo(args, this);

    if (typeof this.type === "undefined") this.type = SERVICE_RESPONSE_UNKNOWN_TYPE as T;
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
    return this.type !== SERVICE_RESPONSE_ERROR_TYPE && this.type !== SERVICE_RESPONSE_UNKNOWN_TYPE;
  }
}
