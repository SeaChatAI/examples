/**
 * Re-export browser Actor transport from @seachat/sdk/render.
 * Experience examples share the same product SSOT transport.
 */
export {
  browserActorTransport,
  installBrowserActorTransport as installActorTransport,
  actorBase,
  sessionsPath,
  ActorHttpError,
  DEFAULT_WORLD_COMPUTE_URL,
} from '@seachat/sdk/render/render';

// Keep SEACHAT_PATHS available for local scripts that imported it from here.
export { SEACHAT_PATHS } from '@seachat/sdk';
