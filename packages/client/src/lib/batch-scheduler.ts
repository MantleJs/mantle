import { MantleClientError } from "./errors.js";
import type { BatchCall, BatchResult } from "./types.js";

/** Subset of `MantleClient` used to send the coalesced `POST /batch` request. */
export interface BatchRestDispatcher {
  request<R>(method: string, path: string, data: unknown | undefined): Promise<R>;
}

interface QueueEntry {
  call: BatchCall;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function toClientError(error: BatchResult["error"]): MantleClientError {
  return new MantleClientError(error?.message ?? "Batch call failed", error?.code ?? 500, error?.name ?? "GeneralError");
}

/**
 * Coalesces service calls made within the same window (default: same microtask
 * tick) into a single `POST /batch` request. Each caller's promise settles
 * independently from its own `BatchResult` entry. Queues longer than `maxSize`
 * split into multiple requests instead of erroring client-side.
 */
export class BatchScheduler {
  private queue: QueueEntry[] = [];
  private scheduled = false;
  private readonly windowMs: number;
  private readonly maxSize: number;

  constructor(
    private readonly rest: BatchRestDispatcher,
    options: { windowMs?: number; maxSize?: number } = {},
    /** Token refresh — entries failing with a per-entry 401 are retried once after a successful refresh. */
    private readonly refresh?: () => Promise<boolean>,
  ) {
    this.windowMs = options.windowMs ?? 0;
    this.maxSize = options.maxSize ?? 25;
  }

  enqueue(call: BatchCall): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ call, resolve, reject });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    if (this.windowMs > 0) {
      setTimeout(() => void this.flush(), this.windowMs);
    } else {
      queueMicrotask(() => void this.flush());
    }
  }

  private async flush(): Promise<void> {
    const batch = this.queue.splice(0, this.maxSize);
    this.scheduled = false;
    if (this.queue.length > 0) this.schedule();
    if (batch.length === 0) return;

    let results: BatchResult[];
    try {
      results = await this.send(batch);
    } catch (error) {
      for (const entry of batch) entry.reject(error);
      return;
    }

    // The batch POST itself succeeds even when individual calls fail with 401
    // (e.g. an expired token rejected by each call's authenticate hook), so the
    // client's usual response-level refresh-retry never triggers — replicate it
    // here: one refresh, one retry of just the 401 entries.
    const expired: { entry: QueueEntry; error: MantleClientError }[] = [];
    batch.forEach((entry, index) => {
      const result = results[index];
      if (result?.status === "success") {
        entry.resolve(result.result);
        return;
      }
      const error = toClientError(result?.error);
      if (error.code === 401 && this.refresh) {
        expired.push({ entry, error });
      } else {
        entry.reject(error);
      }
    });
    if (expired.length > 0) await this.retryExpired(expired);
  }

  private async retryExpired(expired: { entry: QueueEntry; error: MantleClientError }[]): Promise<void> {
    let refreshed = false;
    try {
      refreshed = (await this.refresh?.()) ?? false;
    } catch {
      refreshed = false;
    }
    if (!refreshed) {
      for (const { entry, error } of expired) entry.reject(error);
      return;
    }
    let results: BatchResult[];
    try {
      results = await this.send(expired.map(({ entry }) => entry));
    } catch (error) {
      for (const { entry } of expired) entry.reject(error);
      return;
    }
    expired.forEach(({ entry }, index) => {
      const result = results[index];
      if (result?.status === "success") entry.resolve(result.result);
      else entry.reject(toClientError(result?.error));
    });
  }

  private send(batch: { call: BatchCall }[]): Promise<BatchResult[]> {
    return this.rest.request<BatchResult[]>(
      "POST",
      "batch",
      batch.map((entry) => entry.call),
    );
  }
}
