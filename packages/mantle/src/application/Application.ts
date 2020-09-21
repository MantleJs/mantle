import { HookDefinition, HookFunction, ServiceHook } from "../service";
import { ServiceDefinition, ApplicationService, ApplicationServiceFunction } from "./ApplicationService";

export type ConfigureFunction = (app: Application) => Promise<Application>;

export class Application {
  constructor(hooks: HookDefinition[] = []) {
    this.hookFuncs = [];
    this.serviceDict = Object.create(null);
    hooks.forEach((h) => this.hooks(h));
  }
  private readonly hookFuncs: HookFunction[];
  private readonly serviceDict: { [operationId: string]: ApplicationServiceFunction };

  /**
   * This allows registering service definitions. It instantiates a new ApplicationService using
   * the given definition and registers it under the operationId. See the ApplicationService for
   * details.
   *
   * @param definition - The ServiceDefinition to register the given service
   *
   * @returns {Application}
   */
  public use(definition: ServiceDefinition) {
    const service = ApplicationService(this, definition);
    this.serviceDict[service.operationId] = service;
    return this;
  }

  /**
   * This allows fetching all the registered services
   *
   * @returns {ApplicationService}
   */
  public get services() {
    return Object.keys(this.serviceDict).map((opId) => this.serviceDict[opId]);
  }

  /**
   * This allows fetching allows fetching the ApplicationService associated with the given operationId.
   *
   * @param {string} operationId - The operation ID. This is the either the id property from the ServiceDefinition or an ID derived from the fn.name of the ServiceDefinition.
   *
   * @returns {ApplicationService}
   */
  public service(operationId: string) {
    return this.serviceDict[operationId];
  }

  public hooks(hook?: HookDefinition) {
    if (hook) {
      this.hookFuncs.push(ServiceHook(hook));
    }
    return [...this.hookFuncs];
  }

  public async configure(fn: ConfigureFunction): Promise<Application> {
    fn.call(this, this);

    return this;
  }

  public async listen(port: number) {
    throw new Error("No transport found. Unable to start listening");
  }
}
