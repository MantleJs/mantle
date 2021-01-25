import { ServiceFunction, HookDefinition, ServiceRequest, ServiceResponse, ServicePipe, HookFunction, ServiceHook } from "../service";
import { TransportDescriptor } from "./TransportProvider";
import { Application } from "./Application";
import decamelize from "decamelize";
import pluralize from "pluralize";
import { Server } from "http";

export type ServiceSetupFunction = (app: Application) => Promise<void>;

export interface ServiceDefinition {
  /**
   * This is an optional operation ID that should be unique throughout the app. If not provided,
   * it defaults to the function name.
   *
   * If function is note named and there is no operation ID, an exception is thrown.
   */
  id?: string;

  /**
   * The required services function. It should be a named function if no operation ID is provided, else an exception
   * will be thrown.
   */
  fn: ServiceFunction;

  /**
   * Hook definition to run before and after the service function or when there is an error.
   */
  hooks?: HookDefinition[];

  /**
   * This allows you to group services by resource.
   * (e.g., /users/:id, and /users, would  be grouped in "users" group)
   */
  resource?: string;

  // /**
  //  * An optional field that allows overriding the default URI template path. The default is create a URI based on the resource and method.
  //  */
  // path?: string;

  /**
   * This allows you to specify the service method. The default is to use the verb in the service function.
   */
  method?: ServiceMethod;

  /**
   * An optional setup function. This will be called when the Application.listen is called. If listen is already running, it will be called immediately when registered
   */
  setup?: ServiceSetupFunction;
}

export const ServiceMethod = {
  get GET(): "get" {
    return "get";
  },
  get FIND(): "find" {
    return "find";
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

    return Object.keys(this)
      .filter((key) => !["includes"].includes(key))
      .map((name) => this[name])
      .includes(method.toLowerCase());
  },
};
const serviceMethods = ["get", "find", "search", "create", "update", "patch", "remove"] as const;
export type ServiceMethod = typeof serviceMethods[number];

export interface ApplicationService {
  definition: ServiceDefinition;
  transports: TransportDescriptor[];
  fn: ServiceFunction;
  /** The service name */
  name: string;
  method: ServiceMethod;
  resource: string;
  // path: string;
  app: Application;
  operationId: string;
  setup: (server?: Server) => void;
  isSetup: boolean;
  hooks: (hook: HookDefinition | HookDefinition[]) => ApplicationServiceFunction;
  getHooks: () => HookFunction[];
}

export type ApplicationServiceFunction = ((request: ServiceRequest, infrustructure?: any) => Promise<ServiceResponse>) & ApplicationService;

/**
 * This wraps the service and applys the hooks in the definition, allowing the service to be used in the Application
 *
 * @param {Application} app - The mantle Application instance
 * @param {ServiceDefinition} definition - The service definition
 */
export function ApplicationService(app: Application, definition: ServiceDefinition, transports?: TransportDescriptor[]): ApplicationServiceFunction {
  const hookFuncs = Array.isArray(definition.hooks) ? definition.hooks.map(ServiceHook) : [];
  // eslint-disable-next-line prefer-const
  let service: ApplicationServiceFunction;
  let isSetup = false;

  /** This is so we can retain the service name */
  const fn = {
    [definition.fn.name]: function (request: ServiceRequest, infrustructure?: any): Promise<ServiceResponse> {
      return ServicePipe([...service.app.getHooks(), ...hookFuncs])(service.fn)(request, infrustructure);
    } as ApplicationServiceFunction,
  };

  service = fn[definition.fn.name];
  service.transports = transports ?? [];

  function hooks(hook: HookDefinition | HookDefinition[]) {
    if (Array.isArray(hook)) {
      hook.forEach((h) => hookFuncs.push(ServiceHook(h)));
    } else {
      hookFuncs.push(ServiceHook(hook));
    }

    return service;
  }

  function getHooks() {
    return [...hookFuncs];
  }

  service.definition = definition;
  service.method = getMethod(definition);
  service.fn = definition.fn;
  service.resource = getResource(definition);
  service.operationId = getOperationalId(definition);
  // service.path = definition.path;
  service.app = app;
  service.hooks = hooks;
  service.getHooks = getHooks;

  Object.defineProperty(service, "isSetup", {
    get() {
      return isSetup;
    },
  });

  service.setup = () => {
    if (isSetup) return;
    if (definition.setup) definition.setup(app);

    isSetup = true;
    return service;
  };

  return Object.freeze(service);
}

function getOperationalId(definition: ServiceDefinition) {
  const opId = definition.id || definition.fn.name;
  if (opId === "" || opId === "fn") throw new Error("The service definition must provide an id property if the fn is not a named function.");
  return opId;
}

function getMethod(definition: ServiceDefinition): ServiceMethod {
  const invalidServiceMethodError = new Error("The service definition method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod.");
  let method = definition.method;

  if (method && !ServiceMethod.includes(method)) throw invalidServiceMethodError;
  if (!ServiceMethod.includes(method)) method = parseVerbFromName(definition.fn.name) as ServiceMethod;
  if (!ServiceMethod.includes(method)) method = parseVerbFromName(definition.id) as ServiceMethod;
  if (!ServiceMethod.includes(method)) throw invalidServiceMethodError;

  return method as ServiceMethod;
}
function getResource(definition: ServiceDefinition): string {
  let resource = definition.resource;
  if (resource) return resource;

  resource = parseSubjectFromName(definition.fn.name) || parseSubjectFromName(definition.id);
  if (!resource) throw new Error("The service definition resource is invalid. A resource is required when no named fn service or no operation Id properties are provided.");

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
