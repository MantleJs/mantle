import { Application } from "./Application";
import { ApplicationService } from "./ApplicationService";

export type ProtocolProviderFunction = (app: Application, service: ApplicationService, options?: Record<string, any>, infrastructure?: any) => void;

export enum ProtocolType {
  HTTP = "HTTP",
  WebSocket = "WebSocket",
}

/**
 * This describes the application protocol (e.g HTTP, WebSocket) and the architectural style (REST, RPC, etc)
 */
export interface ProtocolDescriptor<T = ProtocolType> extends Record<string, any> {
  /**
   * The architectural style for the given protocol type (e.g REST, RPC, GraphQL, etc)
   */
  style?: string;
  /**
   * This is the application layer protocol type such as HTTP, WebSocket, etc
   */
  type: T;
}

/**
 * This provides the protocol provider function
 */
export interface ProtocolProvider<T = ProtocolType> extends ProtocolDescriptor<T> {
  fn: ProtocolProviderFunction;
}
