import {
  SeaChat,
  SeaChatAuthRequiredError,
  installHostAuthPushCapture,
  isUsableSeaChatCredential,
  resolveBrowserCredential,
  resolveSeachatOrigin,
  type SeaChatBrowserAuthOptions,
  type SeaChatBrowserAuthPhase,
  type SeaChatConnectionSource,
} from '@seachat/sdk';

export interface SeaChatIdentityConnection {
  seaChatClient: SeaChat;
  source: SeaChatConnectionSource;
  /** Request-only credential for seagate; never serialize into world state. */
  actorAuthorization: string | null;
}

export interface SeaChatIdentityConnectOptions {
  interactive?: boolean;
  onPhase?: (phase: SeaChatBrowserAuthPhase) => void;
}

export const IMMERSIVE_CHAT_STORAGE_KEY = 'seashort.immersiveChatExample.seachatApiKey';
const HOST_PROXY = '/st-seachat';
type SeaChatStorageLike = NonNullable<SeaChatBrowserAuthOptions['storage']>;

const volatileCredentialValues = new Map<string, string>();
const volatileCredentialStorage: SeaChatStorageLike = {
  getItem: (key) => volatileCredentialValues.get(key) ?? null,
  setItem: (key, value) => volatileCredentialValues.set(key, value),
  removeItem: (key) => volatileCredentialValues.delete(key),
};

// Capture a parent push before React starts the first connection attempt.
installHostAuthPushCapture();

async function resolveHostProxyPath(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const buildWantsProxy = meta.env?.VITE_SEASHORT_HOST_PROXY === '1';
  const onPlayHost = /\.play\.seachat\.ai$/i.test(window.location.hostname);
  // Play Experiences always have Caddy /st-seachat for launch grant cookies.
  // Do not gate on a separate /health JSON shape — connect probes /v1/me.
  if (!buildWantsProxy && !onPlayHost) return null;
  return HOST_PROXY;
}

export async function resolveActorAuthorization(
  client: SeaChat,
  interactive: boolean,
): Promise<string | null> {
  const fromClient = client.http.apiKey?.trim() ?? '';
  if (isUsableSeaChatCredential(fromClient)) return fromClient;

  try {
    const credential = await resolveBrowserCredential({
      interactive,
      storageKey: IMMERSIVE_CHAT_STORAGE_KEY,
      storage: volatileCredentialStorage,
    });
    if (isUsableSeaChatCredential(credential.apiKey)) return credential.apiKey.trim();
  } catch {
    /* silent connect may have no volatile browser credential */
  }
  return null;
}

export async function connectSeaChatIdentity(
  options: SeaChatIdentityConnectOptions = {},
): Promise<SeaChatIdentityConnection> {
  const hostProxyPath = await resolveHostProxyPath();
  const connection = await SeaChat.connect({
    // Platform origin SSOT — never hardcode hosts in Experiences.
    baseUrl: resolveSeachatOrigin(),
    storageKey: IMMERSIVE_CHAT_STORAGE_KEY,
    storage: volatileCredentialStorage,
    interactive: options.interactive,
    onPhase: options.onPhase,
    hostProxyPath,
  });
  return {
    seaChatClient: connection.client,
    source: connection.source,
    actorAuthorization: await resolveActorAuthorization(
      connection.client,
      options.interactive === true,
    ),
  };
}

export function disconnectSeaChatIdentity(): void {
  volatileCredentialStorage.removeItem(IMMERSIVE_CHAT_STORAGE_KEY);
}

export function isSeaChatAuthRequiredError(error: unknown): boolean {
  return error instanceof SeaChatAuthRequiredError;
}
