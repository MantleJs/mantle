export { auth } from "./lib/auth.js";
export { authenticate } from "./lib/authenticate.js";
export type { AuthenticateOptions } from "./lib/authenticate.js";
export { authorizeAgent } from "./lib/agent.js";
export { sanitizeUser } from "./lib/sanitize-user.js";
export { memoryRefreshTokenStore } from "./lib/refresh-token-store.js";
export { memoryAgentTokenStore } from "./lib/agent-token-store.js";
export type {
  AgentPrincipal,
  AgentTokenOptions,
  AgentTokenStore,
  AuthConfig,
  AuthEngine,
  AuthResult,
  AuthStrategy,
  IssuedAgentToken,
  JwtPayload,
  RefreshTokenStore,
  TokenPair,
} from "./lib/types.js";
