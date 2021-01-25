import { Server } from "http";
import { TransportDescriptor, TransportProvider } from "./TransportProvider";
import { HookDefinition, HookFunction, ServiceHook } from "../service";
import { ServiceDefinition, ApplicationService, ApplicationServiceFunction } from "./ApplicationService";

export type ConfigureFunction = (app: Application) => Promise<Application>;
export type ApplicationSetupFunction = (server: Server) => Promise<Application>;

export interface ApplicationDefinition {
  /**
   * Hook definition to run before and after every registered service function or when there is an error.
   */
  hooks?: HookDefinition[];
  transports?: TransportProvider[];
  infrastructure?: any;
}

export class Application<Infra extends Record<string, unknown> = any> {
  constructor(definition: ApplicationDefinition = {}) {
    const { hooks = [], transports = [], infrastructure = {} } = definition;
    this.hookFuncs = [];
    this.infrastructure = infrastructure;
    this.transports = transports;
    this.serviceDict = Object.create(null);
    this.setupService = this.setupService.bind(this);
    hooks.forEach((h) => this.hooks(h));
  }
  private readonly infrastructure: Infra;
  private readonly transports: TransportProvider[];
  private readonly hookFuncs: HookFunction[];
  private readonly serviceDict: { [operationId: string]: ApplicationServiceFunction };
  private isSetup = false;
  public get version() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../../package.json").version;
  }
  /**
   * This allows registering service definitions. It instantiates a new ApplicationService using
   * the given definition and registers it under the operationId. See the ApplicationService for
   * more details.
   *
   * @param definition - The ServiceDefinition to register the given service
   * @param transports - Any additional transports that will be forwarded to the transport
   * @returns {Application}
   */
  public use(definition: ServiceDefinition, ...transports: TransportDescriptor[]): Application {
    const service = ApplicationService(this, definition, transports);

    this.serviceDict[service.operationId] = service;

    /** Execute service setup immediately when application is already setup */
    if (this.isSetup) {
      this.setupService(service);
    }

    return this;
  }

  public attachTransport(provider: TransportProvider) {
    if (this.isSetup) throw new Error("Cannot attach transport provider after application has been setup");
    this.transports.push(provider);
  }

  /**
   * This allows fetching all the registered services
   *
   * @returns {ApplicationService[]}
   */
  public get services(): ApplicationService[] {
    return Object.keys(this.serviceDict).map((opId) => this.serviceDict[opId]);
  }

  /**
   * This allows fetching allows fetching the ApplicationService associated with the given operationId.
   *
   * @param {string} operationId - The operation ID. This is the either the id property from the ServiceDefinition or an ID derived from the fn.name of the ServiceDefinition.
   *
   * @returns {ApplicationService}
   */
  public getService(operationId: string): ApplicationService {
    return this.serviceDict[operationId];
  }

  /**
   * This allows registering an application hook.
   *
   * @param {HookDefinition| HookDefinition[]} hook - The applicaiton hook or an array of hooks to be registered
   */
  public hooks(hook?: HookDefinition | HookDefinition[]): Application {
    if (Array.isArray(hook)) {
      hook.forEach((h) => this.hookFuncs.push(ServiceHook(h)));
    } else {
      this.hookFuncs.push(ServiceHook(hook));
    }

    return this;
  }

  /**
   * This allows fetching all registered hooks
   */
  public getHooks(): HookFunction[] {
    return [...this.hookFuncs];
  }

  /**
   * This allows running configuration against the application
   *
   * @param {ConfigureFunction} fn - the configuration function to be executed against the application.
   *
   * @returns {Application}
   */
  public configure(fn: ConfigureFunction): Application {
    fn.call(this, this);
    return this;
  }

  /**
   * This allows setting up the application after server has been started
   *
   * @param server - The HTTP Server
   *
   * @returns {Application}
   */
  public setup(): Application {
    if (this.isSetup) return this;

    this.services.forEach(this.setupService);

    this.isSetup = true;
    return this;
  }

  public async listen() {
    throw new Error("Failed to start listening. No transport attached");
  }

  private setupService(service: ApplicationService) {
    service.setup();
    if (this.transports.length === 0) throw new Error("No transport configured");
    if (service.transports.length == 0) {
      if (this.transports.length === 1) return this.transports[0].fn(this, service, undefined, this.infrastructure);
      throw new Error("More than one default transport configured");
    }

    service.transports.forEach((descriptor) => {
      this.getTransport(descriptor)(this, service, descriptor, this.infrastructure);
    });
  }
  private getTransport(descriptor: TransportDescriptor) {
    const providers = this.transports.filter((transport) => transport.type === descriptor.type && (!descriptor.style || transport.style === descriptor.style));

    if (providers.length === 0) throw new Error(`No transport found for type ${descriptor.type}${descriptor.style ? ` and style ${descriptor.style}` : ""}`);
    if (providers.length === 1) return providers[0].fn;

    throw new Error(`More than one transport found for type ${descriptor.type}${descriptor.style ? ` and style ${descriptor.style}` : ""}`);
  }
}
