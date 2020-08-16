import { ServiceError } from "./ServiceError";
import { NumberArray, ObjectUtil } from "@mantlejs/common";
import * as R from "ramda";

export class ServiceRequest<D = any, P = Record<string, any>, E = any> {
  constructor(properties: Partial<ServiceRequest<D, P>> = {}) {
    ObjectUtil.copyTo(properties, this);
  }
  /** This is the data for an create, update, patch, etc operation */
  public data?: D;
  /** This includes the resource ID, query or any additional parameters */
  public params?: P;
  /** This is where request errors, such as request validation errors, are placed */
  public error?: ServiceError<E>;
  /**
   * This method allows you to get the parameter from the params property and use a type constructor to
   * convert it into the correct type
   *
   * @param {string | string[]} name - The name of the param, and array of property names to allow for drilling down to a property.
   * @param {(value?: S) => T} Type - A type constructor
   */
  public getParam<T = string, S = unknown>(name: string | string[], Type?: (value?: S) => T): T {
    return getParamFromServiceRequest(this, name, Type);
  }
  public getFirstParam<T = string, S = unknown>(name: string[] | string[][], Type?: (value?: S) => T): T {
    return getFirstParamFromServiceRequest(this, name, Type);
  }
  public getParamAsNumber(name: string | string[]): number {
    return getParamFromServiceRequest(this, name, Number);
  }
  public getParamAsNumberArray(name: string | string[]): number[] {
    return getParamFromServiceRequest(this, name, NumberArray);
  }
}

export function getParamFromServiceRequest<T = string, S = any>(svcReq: ServiceRequest, name: string | string[], Type?: (value?: S) => T): T {
  const value: any = R.path(["params"].concat(name), svcReq);

  if (typeof value !== "undefined" && Type) {
    return Type(value);
  }

  return value;
}

export function getFirstParamFromServiceRequest<T = string, S = any>(svcReq: ServiceRequest, names: string[] | string[][], Type?: (value?: S) => T): T {
  const value: any = ObjectUtil.getFirstPropValue(
    (names as any[]).map((n) => ["params"].concat(n)),
    svcReq,
  );

  if (typeof value !== "undefined" && Type) {
    return Type(value);
  }

  return value;
}
