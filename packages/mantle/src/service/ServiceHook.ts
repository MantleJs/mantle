import Debug from "debug";
import { ServiceRequest } from "./ServiceRequest";
import { ServiceResponse, ServiceResponseType } from "./ServiceResponse";

const debug = Debug("@mantlejs/mantle/service/ServiceHook");

export type ServiceFunction<T extends number = ServiceResponseType> = (request: ServiceRequest, infrustructure?: any) => Promise<ServiceResponse<T>>;
export type HookFunction = (fn: ServiceFunction) => ServiceFunction;
export type BeforeFunction = (args: { request: ServiceRequest }) => Promise<ServiceRequest | undefined | null | void>;
export type AfterFunction<T extends number = ServiceResponseType> = (args: { request: ServiceRequest; response: ServiceResponse<T> }) => Promise<ServiceResponse<T> | undefined | null | void>;
export type ErrorFunction<T extends number = ServiceResponseType> = (args: { request: ServiceRequest; response: ServiceResponse<T> }) => Promise<ServiceResponse<T> | undefined | null | void>;

export interface HookDefinition {
  before?: BeforeFunction;
  after?: AfterFunction;
  error?: ErrorFunction;
}

export function ServiceHook<T extends number = ServiceResponseType>(options: HookDefinition): HookFunction {
  return (fn: ServiceFunction): ServiceFunction => {
    /** @note hook is an object to preserve original function name */
    const hook = {
      [fn.name]: async (request: ServiceRequest) => {
        let response: ServiceResponse<T>;

        try {
          if (options.before) {
            debug("Calling the before hook handler");
            request = (await options.before({ request })) || request;
          }
          /** skip remaining before handlers when a request error (e.g. validation) is set */
          if (request.error) {
            debug("Creating error response from the request error");
            response = new ServiceResponse<T>({
              type: ServiceResponseType.ERROR as T,
              payload: request.error,
            });
          } else {
            debug("Calling the next service function");
            response = (await fn(request)) as ServiceResponse<T>;
          }

          /** Skip after handlers when the response has an error */
          if (response.success && options.after) {
            debug("Calling the after hook handler");
            response = ((await options.after({ request, response })) as ServiceResponse<T>) || response;
          }
        } catch (error) {
          debug("Creating error response from unexpected expeception");
          response = new ServiceResponse<T>({
            type: ServiceResponseType.ERROR as T,
            payload: error,
          });
        }

        if (!response.success && options.error) {
          response = ((await options.error({ request, response })) as ServiceResponse<T>) || response;
        }

        debug("Returning the response %o", response);
        return response;
      },
    };

    return hook[fn.name] as ServiceFunction;
  };
}
