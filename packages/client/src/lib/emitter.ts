export type EmitterHandler = (data?: unknown) => void;

/** Minimal internal event emitter — keeps the package dependency-free. */
export class Emitter<E extends string> {
  private readonly listeners = new Map<E, Set<EmitterHandler>>();

  on(event: E, handler: EmitterHandler): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  off(event: E, handler: EmitterHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: E, data?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(data);
  }
}
