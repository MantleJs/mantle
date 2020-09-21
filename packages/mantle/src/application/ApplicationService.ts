import { ServiceFunction, HookDefinition, ServiceRequest, ServiceResponse, ServicePipe, HookFunction, ServiceHook } from "../service";
import { Application } from "./Application";
import decamelize from "decamelize";
import pluralize from "pluralize";

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
   * Hook definition to run before and after the service funtion or when there is an error.
   */
  hooks?: HookDefinition[];

  /**
   * This allows you to group services by resource. By default, services are grouped based on the base URL of the path
   * (e.g., /users/:id, and /users, would  be grouped in "users" group)
   */
  resource?: string;

  /**
   * An optional field that allows overriding the default URI template path. The default is create a URI based on the resource and method.
   */
  path?: string;

  /**
   * This allows you to specify the service method. The default is to use the verb in the service function.
   */
  method?: ServiceMethod;
}
export const ServiceMethod = ["get", "find", "search", "create", "update", "patch", "remove"];
export type ServiceMethod = typeof ServiceMethod[number];

export interface ApplicationService {
  definition: ServiceDefinition;
  service: ServiceFunction;
  method: ServiceMethod;
  resource: string;
  path: string;
  app: Application;
  operationId: string;
  hooks: (hook?: HookDefinition) => HookFunction[];
}
export type ApplicationServiceFunction = ((request: ServiceRequest) => Promise<ServiceResponse>) & ApplicationService;

/**
 * This wraps the service and applys the hooks in the definition, allowing the service to be used in the Application
 *
 * @param {Application} app - The mantle Application instance
 * @param {string} path - URI template
 * @param {HttpMethod} method - The HTTP method
 * @param {ServiceDefinition} definition - The service defintion
 */
export function ApplicationService(app: Application, definition: ServiceDefinition): ApplicationServiceFunction {
  const hookFuncs = Array.isArray(definition.hooks) ? definition.hooks.map(ServiceHook) : [];
  // eslint-disable-next-line prefer-const
  let execute: ApplicationServiceFunction;

  /** This is so we can retain the service name */
  const service = {
    [definition.fn.name]: function (request: ServiceRequest): Promise<ServiceResponse> {
      return ServicePipe([...execute.app.hooks(), ...hookFuncs])(execute.service)(request);
    } as ApplicationServiceFunction,
  };

  execute = service[definition.fn.name];

  function hooks(hook?: HookDefinition) {
    if (hook) {
      hookFuncs.push(ServiceHook(hook));
    }
    return [...hookFuncs];
  }

  execute.definition = definition;
  execute.method = getMethod(definition);
  execute.service = definition.fn;
  execute.resource = getResource(definition);
  execute.operationId = getOperationalId(definition);
  execute.path = definition.path;
  execute.app = app;
  execute.hooks = hooks;

  return Object.freeze(execute);
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
  if (!ServiceMethod.includes(method)) method = parseVerbFromName(definition.fn.name);
  if (!ServiceMethod.includes(method)) method = parseVerbFromName(definition.id);
  if (!ServiceMethod.includes(method)) throw invalidServiceMethodError;

  return method as ServiceMethod;
}
function getResource(definition: ServiceDefinition): string {
  let resource = definition.resource;
  if (resource) return resource;

  resource = getResourceFromPath(definition.path);
  if (resource) return resource;

  resource = parseSubjectFromName(definition.fn.name) || parseSubjectFromName(definition.id);
  if (!resource) throw new Error("The service definition resource is invalid. A resource is require when no path, named fn service, and no operation Id properties are provided.");

  return pluralize(resource);
}

function getResourceFromPath(path: string) {
  if (typeof path !== "string") return undefined;
  const segments = path.split("/");
  return path.startsWith("/") ? segments[1] : segments[0];
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
