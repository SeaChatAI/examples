/** Production Actor acceptance with the real Experience card and a real model. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSeachatOrigin, SEACHAT_PATHS, seachatUrl } from '@seachat/sdk';
import { bindCard, type CardEnvelope } from '../src/player/card.ts';
import { worldIdForBound } from '../src/player/session-store.ts';
import { ccv3ToCharacterCard, type Ccv3CardData } from '@seachat/sdk/render/cards';
import cardEnvelope from '../src/card.json';

type JsonObject = Record<string, unknown>;

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = join(PROJECT_DIR, '.accept/cloud-live-accept.json');
const DEFAULT_BASE = resolveSeachatOrigin();
const WORLDCOMPUTE_BASE = seachatUrl(SEACHAT_PATHS.worldcompute);
const MODEL = process.env.ACCEPT_CLOUD_MODEL?.trim() || 'Leo——婚礼夜。我听见你的三条规矩了。我不会擅自离开主宅；请按当前场景回应。'
const USER_MESSAGE = process.env.ACCEPT_CLOUD_MESSAGE?.trim()
  || 'Leo — wedding night. I heard your three rules. I will not leave the house without leave; answer me in character.';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function productBase(): string {
  const configured = requiredEnv('SEACHAT_PROD_EMAIL_LOGIN_URL');
  const url = new URL(configured);
  return `${url.protocol}//${url.host}`;
}

async function jsonResponse(response: Response, label: string): Promise<JsonObject> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON status=${response.status}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${label} returned invalid JSON status=${response.status}`);
  }
  if (!response.ok) {
    const object = body as JsonObject;
    const error = object.error && typeof object.error === 'object'
      ? JSON.stringify(object.error)
      : String(object.error ?? 'unknown error');
    throw new Error(`${label} failed status=${response.status}: ${error.slice(0, 300)}`);
  }
  return body as JsonObject;
}

async function login(base: string): Promise<{ token: string; identity: unknown; scopes: unknown }> {
  const response = await fetch(`${base}/api/seagate/v1/auth/email/session`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: requiredEnv('SEACHAT_PROD_EMAIL_LOGIN_EMAIL'),
      password: requiredEnv('SEACHAT_PROD_EMAIL_LOGIN_PASSWORD'),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await jsonResponse(response, 'email login');
  const token = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!token) throw new Error('email login response missing accessToken');
  return { token, identity: body.identity, scopes: body.scopes };
}

function authHeaders(token: string, accept: string): Record<string, string> {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function parseSse(text: string): JsonObject[] {
  const events: JsonObject[] = [];
  for (const block of text.split(/\n\n+/)) {
    let eventName = '';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    const parsed = JSON.parse(dataLines.join('\n')) as JsonObject;
    events.push({ ...parsed, type: typeof parsed.type === 'string' ? parsed.type : eventName });
  }
  return events;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const base = productBase();
  const auth = await login(base);
  const converted = ccv3ToCharacterCard(cardEnvelope.data as Ccv3CardData);
  const bound = bindCard(cardEnvelope as CardEnvelope);
  // Same worldId product PlayerCore uses (cardIdentity via worldIdForBound).
  const worldId = worldIdForBound(bound);
  const sessionId = `cloud-live-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const createResponse = await fetch(`${WORLDCOMPUTE_BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders(auth.token, 'application/json'),
    body: JSON.stringify({
      sessionId,
      worldId,
      worldRevision: 'cloud-live-1',
      card: converted.card,
      preset: converted.preset,
      presetCharacterId: converted.presetCharacterId,
      config: { maxContext: 32_000, maxTokens: 512 },
      worldInfo: converted.card.worldInfo ?? [],
      userName: '你',
      model: { model: MODEL, maxTokens: 512, temperature: 0.7 },
      llmMode: 'live',
      allowWIScan: true,
      scanDepth: 8,
      recursive: true,
      maxRecursionSteps: 4,
      useGroupScoring: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const created = await jsonResponse(createResponse, 'create Actor session');
  const revision = typeof created.revision === 'number' ? created.revision : NaN;
  if (!Number.isFinite(revision) || created.sessionId !== sessionId) {
    throw new Error('create Actor session returned an invalid session id or revision');
  }

  const commandResponse = await fetch(
    `${WORLDCOMPUTE_BASE}/sessions/${encodeURIComponent(sessionId)}/commands`,
    {
      method: 'POST',
      headers: authHeaders(auth.token, 'text/event-stream'),
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedRevision: revision,
        kind: 'send',
        input: { text: USER_MESSAGE },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );
  if (!commandResponse.ok) {
    throw new Error(
      `Actor command failed status=${commandResponse.status}: ${(await commandResponse.text()).slice(0, 300)}`,
    );
  }
  const events = parseSse(await commandResponse.text());
  const eventTypes = events.map((event) => String(event.type ?? ''));
  const textDeltas = events
    .filter((event) => event.type === 'text.delta' && typeof event.delta === 'string')
    .map((event) => event.delta as string);
  const committed = events.find((event) => event.type === 'turn.committed');
  const failed = events.find((event) => event.type === 'turn.failed');
  if (failed) throw new Error(`Actor turn.failed: ${JSON.stringify(failed.error ?? failed).slice(0, 400)}`);
  if (textDeltas.length === 0) throw new Error('real model stream did not emit text.delta');
  if (!committed) throw new Error('real model stream did not emit turn.committed');

  const projection = committed.projection as JsonObject | undefined;
  const messages = Array.isArray(projection?.messages) ? projection.messages as JsonObject[] : [];
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const assistantText = typeof assistant?.content === 'string' ? assistant.content.trim() : '';
  if (!assistantText) throw new Error('turn.committed projection has no assistant reply');

  const report = {
    verdict: 'ACCEPT',
    startedAt,
    completedAt: new Date().toISOString(),
    base,
    model: MODEL,
    identity: auth.identity,
    scopes: auth.scopes,
    sessionId,
    createRevision: revision,
    committedRevision: committed.revision,
    eventTypes,
    textDeltaCount: textDeltas.length,
    reply: assistantText,
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verdict: report.verdict,
    model: report.model,
    sessionId: report.sessionId,
    createRevision: report.createRevision,
    committedRevision: report.committedRevision,
    eventTypes: report.eventTypes,
    textDeltaCount: report.textDeltaCount,
    replyPreview: assistantText.slice(0, 240),
    report: REPORT_PATH,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
