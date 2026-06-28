import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  correlationId: string;
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
