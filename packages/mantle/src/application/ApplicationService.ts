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
   * This allows you to group services. By default, services are grouped based on the base URL of the path
   * (e.g., /users/:id, and /users, would  be grouped in "users" group)
   */
  group?: string;

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
  group: string;
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
export function ApplicationService(app: Application, path: string, definition: ServiceDefinition): ApplicationServiceFunction {
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
  execute.service = definition.fn;
  execute.method = getMethod(definition);
  execute.group = getGroup(definition);
  execute.path = path;
  execute.app = app;
  execute.operationId = getOperationalId(definition);
  execute.hooks = hooks;

  return execute;
}

function getOperationalId(definition: ServiceDefinition) {
  const opId = definition.id || definition.fn.name;
  if (opId === "" || opId === "fn") throw new Error("The service definition must provide an id property if the fn is not a named function");
  return opId;
}

function getMethod(definition: ServiceDefinition): ServiceMethod {
  const method = (definition.method || decamelize(definition.fn.name || definition.id, "_").split("_")[0]).toLowerCase();
  if (!ServiceMethod.includes(method)) {
    throw new Error("The service definition a service method is invalid. The method property or the first verb in the service name or operation Id must be a valid ServiceMethod");
  }
  return method as ServiceMethod;
}
function getGroup(definition: ServiceDefinition): string {
  const group = (
    definition.group ||
    decamelize(definition.fn.name || definition.id, "_")
      .split("_")
      .slice(1)
      .join("")
  ).toLowerCase();

  return pluralize(group);
}
