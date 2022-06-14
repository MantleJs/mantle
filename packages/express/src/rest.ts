import { Application, ApplicationServiceFunction, ServiceRequest, ServiceError, ServiceResponse, ServiceResponseType, ProtocolType } from "@mantlejs/mantle";
import { Handler, Request, Response, NextFunction } from "express";
import { HttpVerb, HttpStatus, PathUtil, Enum } from "@mantlejs/common";
import { MantleExpress } from "./express";
import urlJoin from "url-join";
import decamelize from "decamelize";
import pluralize from "pluralize";

export type RestServiceFunction = ApplicationServiceFunction & {
  method: ServiceMethod;
  resource: string;
};

export const ServiceMethod = {
  get GET(): "get" {
    return "get";
  },
  get FIND(): "find" {
    return "find";
  },
  get EXECUTE(): "execute" {
    return "execute";
  },
  get SEARCH(): "search" {
    return "search";
  },
  get CREATE(): "create" {
    return "create";
  },
  get UPDATE(): "update" {
    return "update";
  },
  get PATCH(): "patch" {
    return "patch";
  },
  get REMOVE(): "remove" {
    return "remove";
  },
  includes(method: string) {
    if (typeof method !== "string") return false;

    return this.values.includes(method.toLowerCase());
  },
  get values() {
    return Object.keys(this)
      .filter((key) => !["includes", "values"].includes(key))
      .map((name) => this[name]);
  },
};

export const serviceMethods = ["get", "find", "search", "execute", "create", "update", "patch", "remove"] as const;
export type ServiceMethod = typeof serviceMethods[number];

export const ServiceMethodToHttpVerbMap: { [serviceMethod: string]: HttpVerb } = {
  [ServiceMethod.GET]: HttpVerb.GET,
  [ServiceMethod.FIND]: HttpVerb.GET,
  [ServiceMethod.EXECUTE]: HttpVerb.POST,
  [ServiceMethod.SEARCH]: HttpVerb.SEARCH,
  [ServiceMethod.CREATE]: HttpVerb.POST,
  [ServiceMethod.UPDATE]: HttpVerb.PUT,
  [ServiceMethod.PATCH]: HttpVerb.PATCH,
  [ServiceMethod.REMOVE]: HttpVerb.DELETE,
};

export const ServiceErrorType = Object.freeze({
  BAD_REQUEST: "BadRequestError",
  VALIDATION: "ValidationError",
  ACCESS_DENIED: "AccessDeniedError",
  AUTH_TIMEOUT: "AuthorizationTimeoutError",
  INSUFFICIENT_RIGHTS: "InsufficientRightsError",
  CSRF_TOKEN: "CsrfTokenError",
  NOT_FOUND: "NotFoundError",
  DATA_ACCESS_ERROR: "DataAccessError",
  UNEXPECTED: "UnexpectedError",
  STATE_CONFLICT: "StateConflictError",
});

export const ServiceErrorHttpStatusMap = Object.freeze({
  [ServiceErrorType.VALIDATION]: HttpStatus.BAD_REQUEST,
  [ServiceErrorType.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ServiceErrorType.ACCESS_DENIED]: HttpStatus.UNAUTHORIZED,
  [ServiceErrorType.AUTH_TIMEOUT]: HttpStatus.AUTH_TIMEOUT,
  [ServiceErrorType.INSUFFICIENT_RIGHTS]: HttpStatus.FORBIDDEN,
  [ServiceErrorType.CSRF_TOKEN]: HttpStatus.FORBIDDEN,
  [ServiceErrorType.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ServiceErrorType.DATA_ACCESS_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ServiceErrorType.UNEXPECTED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ServiceErrorType.STATE_CONFLICT]: HttpStatus.CONFLICT,
});

export interface RestHttpProtocolOptions {
  route?: {
    uri?: string;
    verb?: HttpVerb;
    /** Override the default resource ID variable name (e.g. id) in the default URI template that is generated */
    idParamName?: string;
    /**
     * Used to override the resource collection name
     * (e.g., /users/:id, and /users, would  be grouped in "users" group)
     */
    resource?: string;
  };
  middleware?: {
    before?: Handler[];
    after?: Handler[];
  };
}

export interface HandleResponseArgs {
  request: ServiceRequest;
  response: ServiceResponse;
  service: RestServiceFunction;
  infrustructure: any;
  route: { req: Request; res: Response };
}

export function rest(formatter: Handler = defaultFormatter) {
  return function rest(app: MantleExpress) {
    app.protocols({ style: "REST", type: ProtocolType.HTTP, fn: provider });
  };

  function provider(app: Application, appService: ApplicationServiceFunction, options: RestHttpProtocolOptions = {}, infrustructure: any) {
    const { middleware = {}, route = {} } = options;
    const { before = [], after = [] } = middleware;
    const expressApp: MantleExpress = app as MantleExpress;
    const service: RestServiceFunction = appService as RestServiceFunction;

    if (!expressApp.route) throw new Error("@mantlejs/express needs to wrap the mantle application before using @mantlejs/express/rest");

    if (typeof formatter === "function") {
      after.push(formatter);
    }

    service.method = deriveMethod(service);
    service.resource = deriveResource(service);

    const uri = createUri(expressApp, service, options);
    const verb: HttpVerb = route.verb || ServiceMethodToHttpVerbMap[service.method];
    expressApp.route(uri)[verb](...before, createHandler(service, infrustructure), ...after);
  }
}

function createHandler(service: RestServiceFunction, infrustructure: any) {
  return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    const { body: data, params = {}, query = {} } = req;
    const request: ServiceRequest = new ServiceRequest({ data, params: { ...params, ...query } });
    const route = { req, res };

    try {
      const response = await execute(service, request, infrustructure);
      handleResponse({ request, response, infrustructure, route, service });
    } catch (error) {
      return next(error);
    }
    next();
  };
}
function handleResponse({ response, route, service }: HandleResponseArgs) {
  const { res } = route;
  res.status(getResponseHttpStatusCode(response, service)).send(response.payload);
}

async function execute(service: RestServiceFunction, request: ServiceRequest, infrastructure: any) {
  try {
    return await Promise.resolve(service(request, infrastructure));
  } catch (error) {
    return createErrorResponse(error);
  }
}

function createErrorResponse(error: any): ServiceResponse {
  return new ServiceResponse({
    type: ServiceResponseType.ERROR,
    payload: createServiceError(error),
  });
}

function createServiceError(error: any): ServiceError {
  if (isServiceError(error)) return error;
}

function isServiceError(error: any) {
  if (!error) return false;
  if (Enum.hasValue(ServiceErrorType, error.type)) return true;
  return false;
}

function getErrorHttpStatusCode(error: ServiceError) {
  return error && (ServiceErrorHttpStatusMap[error.type] || HttpStatus.INTERNAL_SERVER_ERROR);
}

function getResponseHttpStatusCode(response: ServiceResponse, service: RestServiceFunction) {
  if (!response) return HttpStatus.INTERNAL_SERVER_ERROR;
  if (response.type === ServiceResponseType.ACCEPTED) return HttpStatus.ACCEPTED;
  if (response.type === ServiceResponseType.SUCCESS) {
    if (service.method === ServiceMethod.CREATE) return HttpStatus.CREATED;
    if (response.payload) return HttpStatus.OK;
    return HttpStatus.NO_CONTENT;
  }
  return getErrorHttpStatusCode(response.payload);
}

function defaultFormatter(req: Request, res: Response & { data: any }, next: NextFunction) {
  if (res.data === undefined) {
    return next();
  }

  res.format({
    json: function () {
      res.json(res.data);
    },
  });
}

function createUri(expressApp: MantleExpress, service: RestServiceFunction, options: RestHttpProtocolOptions): string {
  const { basePath = "/" } = expressApp;

  if (typeof options.route?.uri === "string") return urlJoin("/", basePath, PathUtil.trimSlashes(options.route.uri));

  return urlJoin(basePath, service.resource, getUriTemplate(service, options));
}

function getUriTemplate(service: ApplicationServiceFunction, options: RestHttpProtocolOptions) {
  switch (deriveMethod(service)) {
    case ServiceMethod.GET:
    case ServiceMethod.PATCH:
    case ServiceMethod.UPDATE:
    case ServiceMethod.REMOVE:
      return `/:${options.route?.idParamName || "id"}`;
    default:
      return "";
  }
}

function deriveMethod(service: ApplicationServiceFunction): ServiceMethod {
  let method = parseVerbFromName(service.fn.name) as ServiceMethod;

  if (!ServiceMethod.includes(method)) method = parseVerbFromName(service.operationId) as ServiceMethod;
  if (!ServiceMethod.includes(method)) throw new Error("Unable to derive rest service method. The first verb in the service name or operation Id must be a valid ServiceMethod.");

  return method as ServiceMethod;
}
function deriveResource(service: ApplicationServiceFunction): string {
  const resource = parseSubjectFromName(service.fn.name) || parseSubjectFromName(service.operationId);
  if (!resource) throw new Error("Unable to derive rest resource from service function or operation ID.");

  return pluralize(resource);
}
function parseVerbFromName(name: string) {
  if (typeof name !== "string") return undefined;
  return decamelize(name, "_").split("_")[0].toLowerCase();
}
function parseSubjectFromName(name: string) {
  if (typeof name !== "string") return undefined;
  const parts = decamelize(name, "_").split("_");
  if (parts.length < 2) return undefined;
  return decamelize(name, "_").split("_")[1].toLowerCase();
}
