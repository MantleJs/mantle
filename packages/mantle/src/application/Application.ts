import { HookDefinition, HookFunction, ServiceHook } from "../service";
import { ServiceDefinition, ApplicationService, ApplicationServiceFunction, ServiceMethod } from "./ApplicationService";

export class Application {
  constructor(hooks: HookDefinition[] = []) {
    this.hookFuncs = [];
    this.serviceHashtable = Object.create(null);
    hooks.forEach((h) => this.hooks(h));
  }
  private readonly hookFuncs: HookFunction[];
  private readonly serviceHashtable: { [operationId: string]: ApplicationServiceFunction };

  public use(path: string, definition: ServiceDefinition) {
    const service = ApplicationService(this, path, definition);
    this.serviceHashtable[service.operationId] = service;
    return this;
  }

  public get services() {
    return Object.keys(this.serviceHashtable).map((opId) => this.serviceHashtable[opId]);
  }

  public service(operationId: string) {
    return this.serviceHashtable[operationId];
  }

  public hooks(hook?: HookDefinition) {
    if (hook) {
      this.hookFuncs.push(ServiceHook(hook));
    }
    return [...this.hookFuncs];
  }
}
