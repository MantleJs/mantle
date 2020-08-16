import { ObjectUtil } from "@mantlejs/common";

export enum ServiceErrorType {
  NOT_FOUND = "NotFoundError",
  DATA_ACCESS_ERROR = "DataAccessError",
  INSUFFICIENT_RIGHTS = "InsufficientRightsError",
  UNEXPECTED = "UnexpectedError",
  VALIDATION = "ValidationError",
  STATE_CONFLICT = "StateConflictError",
}

export class ServiceError<T = ServiceErrorType> {
  constructor(properties: Partial<ServiceError<T>> = {}, freeze = true) {
    ObjectUtil.copyTo(properties, this);
    if (freeze) {
      this.frozen = true;
      Object.freeze(this);
    } else {
      this.frozen = false;
    }
  }

  public frozen: boolean;
  public type: T;
  public message: string;
  public inner?: Error;
  public data?: Record<string, any>;
}
