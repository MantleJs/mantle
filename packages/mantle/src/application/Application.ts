import { Server } from "http";
import { ProtocolDescriptor, ProtocolProvider } from "./ProtocolProvider";
import { HookDefinition, HookFunction, ServiceHook } from "../service";
import { ServiceDefinition, ApplicationService, ApplicationServiceFunction } from "./ApplicationService";

export type ConfigureFunction = (app: Application) => Promise<Application>;
export type ApplicationSetupFunction = (server: Server) => Promise<Application>;
export interface ServiceOperationalIdLookup {
  [operationId: string]: ApplicationServiceFunction;
}

export interface ApplicationDefinition {
  /**
   * Hook definition to run before and after every registered service function or when there is an error.
   */
  hooks?: HookDefinition[];
  protocols?: ProtocolProvider[];
  infrastructure?: any;
}

export class Application<Infra extends Record<string, unknown> = any> {
  constructor(definition: ApplicationDefinition = {}) {
    const { hooks = [], protocols = [], infrastructure = {} } = definition;
    this.hookFuncs = [];
    this.infrastructure = infrastructure;
    this.protocolProviders = protocols;
    this.serviceOpIdLookup = Object.create(null);
    this.setupService = this.setupService.bind(this);
    hooks.forEach((h) => this.hooks(h));
  }
  private readonly infrastructure: Infra;
  private readonly protocolProviders: ProtocolProvider[];
  private readonly hookFuncs: HookFunction[];
  private readonly serviceOpIdLookup: ServiceOperationalIdLookup;
  private isSetup = false;
  public get version() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../../package.json").version;
  }
  /**
   * A fluent API that allows registering service definitions. It instantiates a new ApplicationService using
   * the given definition and registers it under the operationId. See the ApplicationService for
   * more details.
   *
   * @param definition - The ServiceDefinition to register the given service
   * @param protocols - Any additional protocols that will be forwarded to the protocol
   * @returns {Application}
   */
  public use(definition: ServiceDefinition, ...protocols: ProtocolDescriptor[]): Application {
    const service = ApplicationService(this, definition, protocols);

    this.serviceOpIdLookup[service.operationId] = service;

    /** Execute service setup immediately when application is already setup */
    if (this.isSetup) {
      this.setupService(service);
    }

    return this;
  }

  /**
   *
   * @param provider - a protocol provider to attach to the application. Protocols cannot be attached if the application is already setup.
   */
  public attachProtocol(provider: ProtocolProvider) {
    if (this.isSetup) throw new Error("Cannot attach protocol provider after application has been setup");
    this.protocolProviders.push(provider);
  }

  /**
   * A fluent API that allows attaching a protocal provider.
   *
   * @throws - when the application is already setup
   *
   * @param protocol - a protocol provider(s) to attach to the application. Protocols cannot be attached if the application is already setup.
   * @returns
   */
  public protocols(protocol?: ProtocolProvider | ProtocolProvider[]): Application {
    if (this.isSetup) throw new Error("Cannot attach protocol provider after application has been setup");

    if (Array.isArray(protocol)) {
      protocol.forEach((p) => this.protocolProviders.push(p));
    } else {
      this.protocolProviders.push(protocol);
    }

    return this;
  }

  /**
   * This allows fetching all the registered services
   *
   * @returns {ApplicationService[]}
   */
  public get services(): ApplicationService[] {
    return Object.keys(this.serviceOpIdLookup).map((opId) => this.serviceOpIdLookup[opId]);
  }

  /**
   * This allows fetching allows fetching the ApplicationService associated with the given operationId.
   *
   * @param {string} operationId - The operation ID. This is the either the id property from the ServiceDefinition or an ID derived from the fn.name of the ServiceDefinition.
   *
   * @returns {ApplicationService}
   */
  public getService(operationId: string): ApplicationService {
    return this.serviceOpIdLookup[operationId];
  }

  /**
   * An fluent API that allows registering an application hook via a HookDefinition. This method will use the definition to create a service hook to register.
   *
   * @param {HookDefinition | HookDefinition[]} [hook] - The application hook definition or an array of hook definitions to be registered
   *
   * @returns {Application}
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
   * This allows fetching all registered service hooks
   *
   * @returns {HookFunction[]} - A copy of the registered service hooks
   */
  public getHooks(): HookFunction[] {
    return [...this.hookFuncs];
  }

  /**
   * A fluent API that allows running configuration against the application
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
   * A fluent API that allows setting up the application after server has been started
   *
   * param server - The HTTP Server
   *
   * @returns {Application}
   */
  public setup(): Application {
    if (this.isSetup) return this;

    this.services.forEach(this.setupService);

    this.isSetup = true;
    return this;
  }

  /**
   * The listen is overridden by the given server wrapper (e.g. @mantlejs/express)
   */
  public async listen() {
    throw new Error("Failed to start listening. No protocol attached");
  }

  //@region ------- Private Methods -------
  private setupService(service: ApplicationService) {
    service.setup();
    if (this.protocolProviders.length === 0) throw new Error("No protocol configured");
    if (service.protocols.length == 0) {
      if (this.protocolProviders.length === 1) return this.protocolProviders[0].fn(this, service, undefined, this.infrastructure);
      throw new Error("More than one default protocol configured");
    }

    service.protocols.forEach((descriptor: ProtocolDescriptor) => {
      this.getProtocol(descriptor)(this, service, descriptor, this.infrastructure);
    });
  }
  private getProtocol(descriptor: ProtocolDescriptor) {
    const providers = this.protocolProviders.filter((protocol) => protocol.type === descriptor.type && (!descriptor.style || protocol.style === descriptor.style));

    if (providers.length === 0) throw new Error(`No protocol found for type ${descriptor.type}${descriptor.style ? ` and style ${descriptor.style}` : ""}`);
    if (providers.length === 1) return providers[0].fn;

    throw new Error(`More than one protocol found for type ${descriptor.type}${descriptor.style ? ` and style ${descriptor.style}` : ""}`);
  }
  //@endregion ------- Private Methods -------
}
