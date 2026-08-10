/**
 * SeaChat identity helpers for the shared player.
 * LLM transport is cloud worldcompute (Actor); no in-browser SdkLlmClient.
 */
export {
  connectSeaChatIdentity as connectSeaChatLlm,
  disconnectSeaChatIdentity as disconnectSeaChatLlm,
  isSeaChatAuthRequiredError,
  resolveActorAuthorization,
  connectSeaChatIdentity,
  disconnectSeaChatIdentity,
  type SeaChatIdentityConnection,
  type SeaChatIdentityConnectOptions,
} from './identity-connection.ts';

export { PromptBudgetError, formatSeaChatError } from './errors.ts';
export type { ConnectPhase } from './player-runtime.ts';
