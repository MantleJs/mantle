import { Application, ApplicationDefinition } from "./Application";

export * from "./Application";
export * from "./ApplicationService";
export * from "./ProtocolProvider";

export function mantle(definition: ApplicationDefinition = {}) {
  return new Application(definition);
}

export default mantle;
