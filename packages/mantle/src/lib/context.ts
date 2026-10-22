import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  /** Set by the HTTP transports from `X-Request-Id` (validated) or a generated UUID. */
  requestId?: string;
  /** @deprecated Read `requestId`. The HTTP transports still expose it, as a non-enumerable alias, for one release. */
  correlationId?: string;
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs fn inside a request context. All async operations spawned within fn inherit the context. */
export function withContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Returns the current request context, or undefined when called outside a withContext scope. */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The context the HTTP transports bind for each request. `correlationId` is a non-enumerable alias of
 * `requestId`, so existing `getContext().correlationId` readers keep working while loggers, which spread
 * the context into every record, emit `requestId` only.
 */
export function createRequestContext(requestId: string): RequestContext {
  const context: RequestContext = { requestId };
  Object.defineProperty(context, "correlationId", { get: () => context.requestId, enumerable: false });
  return context;
}
