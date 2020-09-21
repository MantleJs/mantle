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

  public use(definition: ServiceDefinition) {
    const service = ApplicationService(this, definition);
    this.serviceDict[service.operationId] = service;
    return this;
  }

  public get services() {
    return Object.keys(this.serviceDict).map((opId) => this.serviceDict[opId]);
  }

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
}
