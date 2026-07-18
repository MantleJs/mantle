// Ambient declaration for the optional peer dependency, so the dynamic import
// in socket-manager.ts type-checks without socket.io-client installed. Not
// emitted to dist — consumers with the real package see its own types.
declare module "socket.io-client" {
  export function io(
    url: string,
    options?: Record<string, unknown>,
  ): {
    on(event: string, handler: (...args: unknown[]) => void): unknown;
    off(event: string, handler: (...args: unknown[]) => void): unknown;
  };
}
