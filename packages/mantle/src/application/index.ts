import { Application, ApplicationDefinition } from "./Application";

export * from "./Application";
export * from "./ApplicationService";
export * from "./TransportProvider";

export function mantle(definition: ApplicationDefinition = {}) {
  return new Application(definition);
}

export default mantle;
