import { afterEach, describe, expect, test } from 'bun:test';
import { SeaChat } from '@seachat/sdk';
import {
  connectSeaChatIdentity,
  disconnectSeaChatIdentity,
  resolveActorAuthorization,
} from '../src/player/identity-connection.ts';

type MessageListener = (event: { data?: unknown }) => void;

const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;

function gatewayJwt(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function restoreWindow(): void {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
}

afterEach(() => {
  disconnectSeaChatIdentity();
  globalThis.fetch = originalFetch;
  restoreWindow();
});

describe('embedded identity authorization', () => {
  test('passes a short-lived gateway bearer from the connected client', async () => {
    const token = gatewayJwt();
    const client = new SeaChat({ apiKey: token });
    await expect(resolveActorAuthorization(client, false)).resolves.toBe(token);
  });

  test('does not read a bearer from window.localStorage', async () => {
    const token = gatewayJwt();
    let localStorageReads = 0;
    (globalThis as { window?: unknown }).window = {
      parent: null,
      localStorage: {
        getItem: () => {
          localStorageReads += 1;
          return token;
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    };

    const client = new SeaChat({ apiKey: 'st-seachat-proxy' });
    await expect(resolveActorAuthorization(client, false)).resolves.toBeNull();
    expect(localStorageReads).toBe(0);
  });

  test('shares the volatile login credential with Actor authorization', async () => {
    const token = gatewayJwt();
    (globalThis as { window?: unknown }).window = {
      parent: null,
      open: () => ({ close: () => undefined }),
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/seagate/v1/auth/desktop/sessions')) {
        return Response.json({
          sessionId: 'session-1',
          clientSecret: 'secret-1',
          authorizeUrl: 'https://seachat.ai/authorize',
          pollIntervalSeconds: 0.001,
        });
      }
      if (url.endsWith('/api/seagate/v1/auth/desktop/sessions/session-1/token')) {
        return Response.json({ accessToken: token });
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    };

    const connection = await connectSeaChatIdentity({ interactive: true });
    expect(connection.seaChatClient.http.apiKey).toBe(token);

    const proxyClient = new SeaChat({ apiKey: 'st-seachat-proxy' });
    await expect(resolveActorAuthorization(proxyClient, false)).resolves.toBe(token);
  });

  test('accepts an unsolicited host credential push for direct Actor requests', async () => {
    const token = gatewayJwt();
    const listeners = new Set<MessageListener>();
    const emit = (data: unknown) => {
      for (const listener of [...listeners]) listener({ data });
    };
    const parent = {
      postMessage: () => queueMicrotask(() => {
        emit({ type: 'seachat-platform-auth-push', apiKey: token });
      }),
    };
    (globalThis as { window?: unknown }).window = {
      parent,
      addEventListener: (type: string, listener: MessageListener) => {
        if (type === 'message') listeners.add(listener);
      },
      removeEventListener: (type: string, listener: MessageListener) => {
        if (type === 'message') listeners.delete(listener);
      },
    };

    const client = new SeaChat({ apiKey: 'st-seachat-proxy' });
    await expect(resolveActorAuthorization(client, false)).resolves.toBe(token);
  });
});
