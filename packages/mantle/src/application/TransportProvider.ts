import { Application } from "./Application";
import { ApplicationService } from "./ApplicationService";

export type TransportProviderFunction = (app: Application, service: ApplicationService, options?: Record<string, any>, infrastructure?: any) => void;

export enum TransportType {
  HTTP = "HTTP",
  WebSocket = "WebSocket",
}

/**
 * This describes the transport (e.g HTTP, WebSocket) and the architectural style (REST, RPC, etc)
 */
export interface TransportDescriptor<T = TransportType> extends Record<string, any> {
  /**
   * The architectural style for the given protocol type (e.g REST, RPC, GraphQL, etc)
   */
  style?: string;
  /**
   * This is the application layer type such as HTTP, WebSocket, etc, not to be confused with
   * the transport layer.
   */
  type: T;
}

/**
 * This provides the transport function
 */
export interface TransportProvider<T = TransportType> extends TransportDescriptor<T> {
  fn: TransportProviderFunction;
}
