/** Local Vite UI -> production Actor -> real model browser acceptance. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Request } from 'playwright';
import { childEnv, installLocalNoProxy } from './accept-env.ts';

type JsonObject = Record<string, unknown>;

installLocalNoProxy();

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = join(PROJECT_DIR, '.accept/cloud-ui-accept.json');
const SCREENSHOT_PATH = join(PROJECT_DIR, '.accept/cloud-ui.png');
const MOBILE_SCREENSHOT_PATH = join(PROJECT_DIR, '.accept/cloud-ui-mobile.png');
const USER_MESSAGE = process.env.ACCEPT_CLOUD_UI_MESSAGE?.trim()
  || 'Leo，我听见你的三条规矩了。我不会擅自离开——请按当前场景回应。'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function productBase(): string {
  const url = new URL(requiredEnv('SEACHAT_PROD_EMAIL_LOGIN_URL'));
  return `${url.protocol}//${url.host}`;
}

async function readJson(response: Response, label: string): Promise<JsonObject> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON status=${response.status}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} returned invalid JSON status=${response.status}`);
  }
  const body = parsed as JsonObject;
  if (!response.ok) {
    throw new Error(`${label} failed status=${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  }
  return body;
}

async function browserAccessToken(base: string): Promise<string> {
  const login = await readJson(
    await fetch(`${base}/api/seagate/v1/auth/email/session`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: requiredEnv('SEACHAT_PROD_EMAIL_LOGIN_EMAIL'),
        password: requiredEnv('SEACHAT_PROD_EMAIL_LOGIN_PASSWORD'),
      }),
      signal: AbortSignal.timeout(20_000),
    }),
    'email login',
  );
  const accessToken = typeof login.accessToken === 'string' ? login.accessToken.trim() : '';
  if (!accessToken) throw new Error('email login response missing accessToken');
  return accessToken;
}

async function openPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate local Vite port'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForReply(page: Page, baseline: number): Promise<string> {
  const rows = page.locator('.message-row.is-character .message-character');
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const count = await rows.count();
    const streaming = await page.getByRole('button', { name: 'Stop generation', exact: true }).count();
    if (count > baseline && streaming === 0) {
      const text = (await rows.last().innerText()).trim();
      if (text) return text;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('real assistant reply did not settle in the UI');
}

function isWorldcomputeSessionsUrl(url: string): boolean {
  return url.includes('/api/worldcompute/sessions') || url.includes('/__worldcompute/sessions');
}

function commandJson(request: Request): JsonObject | null {
  if (
    request.method() !== 'POST'
    || !isWorldcomputeSessionsUrl(request.url())
    || !request.url().endsWith('/commands')
  ) return null;
  try {
    return JSON.parse(request.postData() ?? '{}') as JsonObject;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const cloudBase = productBase();
  const accessToken = await browserAccessToken(cloudBase);
  const port = await openPort();
  const localBase = `http://127.0.0.1:${port}`;
  let viteLog = '';
  const vite = spawn(
    'node',
    [
      join(PROJECT_DIR, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: PROJECT_DIR,
      env: childEnv({
        WEBIDE_PORT: String(port),
        WORLD_COMPUTE_URL: `${cloudBase}/api/worldcompute`,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  vite.stdout?.on('data', (chunk) => { viteLog += String(chunk); });
  vite.stderr?.on('data', (chunk) => { viteLog += String(chunk); });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ({ apiKey }) => {
      const targetOrigin = window.location.origin;
      if (targetOrigin === 'null') return;
      const pushCredential = () => window.postMessage(
        { type: 'seachat-platform-auth-push', apiKey },
        targetOrigin,
      );
      pushCredential();
      const timer = window.setInterval(pushCredential, 25);
      window.setTimeout(() => window.clearInterval(timer), 30_000);
    },
    { apiKey: accessToken },
  );
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const network: Array<{
    method: string;
    url: string;
    atMs: number;
    status?: number;
    failure?: string;
  }> = [];
  const navigationStartedAt = Date.now();
  const trackedUrl = (raw: string): string | null => {
    const url = new URL(raw);
    if (
      !url.pathname.includes('/worldcompute')
      && !url.pathname.includes('/__worldcompute/')
      && !url.pathname.includes('/v1/data/')
      && !url.pathname.includes('/v1/models')
      && !url.pathname.includes('/v1/me')
    ) return null;
    return `${url.origin}${url.pathname}`;
  };
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = trackedUrl(request.url());
    if (url) network.push({ method: request.method(), url, atMs: Date.now() - navigationStartedAt });
  });
  page.on('response', (response) => {
    const url = trackedUrl(response.url());
    if (url) {
      network.push({
        method: response.request().method(),
        url,
        atMs: Date.now() - navigationStartedAt,
        status: response.status(),
      });
    }
  });
  page.on('requestfailed', (request) => {
    const url = trackedUrl(request.url());
    if (url) {
      network.push({
        method: request.method(),
        url,
        atMs: Date.now() - navigationStartedAt,
        failure: request.failure()?.errorText ?? 'request failed',
      });
    }
  });

  let commandBody: JsonObject | null = null;
  let resolveSessionReady!: () => void;
  let rejectSessionReady!: (reason: unknown) => void;
  const sessionReady = new Promise<void>((resolve, reject) => {
    resolveSessionReady = resolve;
    rejectSessionReady = reject;
  });
  let resolveSse: (value: string) => void;
  let rejectSse: (reason: unknown) => void;
  const commandSse = new Promise<string>((resolve, reject) => {
    resolveSse = resolve;
    rejectSse = reject;
  });
  page.on('request', (request) => {
    const body = commandJson(request);
    if (body?.kind === 'send') commandBody = body;
  });
  page.on('response', (response) => {
    const request = response.request();
    if (isWorldcomputeSessionsUrl(response.url()) && !response.url().includes('/commands')) {
      if (response.status() >= 200 && response.status() < 300) resolveSessionReady();
      else if (request.method() === 'POST') {
        response.text().then(
          (body) => rejectSessionReady(new Error(`Actor session bootstrap ${response.status()}: ${body.slice(0, 300)}`)),
          rejectSessionReady,
        );
      }
    }
    if (commandJson(request)?.kind !== 'send') return;
    response.text().then(resolveSse, rejectSse);
  });

  try {
    await waitForUrl(localBase);
    await page.goto(localBase, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Product shell has no dogfood badge; wait for chat chrome.
    const composer = page.locator('textarea[aria-label="Message"]');
    await composer.waitFor({ state: 'visible', timeout: 60_000 });
    await Promise.race([
      sessionReady,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Actor session bootstrap timeout')), 15_000)),
    ]);
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
        return textarea !== null && !textarea.disabled;
      },
      undefined,
      { timeout: 60_000 },
    );
    const baseline = await page.locator('.message-row.is-character .message-character').count();
    await composer.fill(USER_MESSAGE);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();

    const [sse, reply] = await Promise.all([
      Promise.race([
        commandSse,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('command SSE timeout')), 180_000)),
      ]),
      waitForReply(page, baseline),
    ]);
    if (!sse.includes('event: text.delta') && !sse.includes('"type":"text.delta"')) {
      throw new Error(`browser command SSE missing text.delta: ${sse.slice(0, 1_500)}`);
    }
    if (!sse.includes('event: turn.committed') && !sse.includes('"type":"turn.committed"')) {
      throw new Error(`browser command SSE missing turn.committed: ${sse.slice(0, 1_500)}`);
    }
    const commandKeys = Object.keys(commandBody ?? {}).sort();
    const forbidden = ['card', 'credential', 'preset', 'snapshot', 'worldInfo', 'worldSpec']
      .filter((key) => commandKeys.includes(key));
    if (forbidden.length > 0) throw new Error(`browser command contains forbidden keys: ${forbidden}`);

    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    // Mobile viewport gate — the desktop shot never exercised the ≤760px
    // stack, which is exactly where H5 layout broke. iPhone 13 portrait.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    await page.screenshot({ path: MOBILE_SCREENSHOT_PATH, fullPage: false });
    if (mobileOverflow.scrollWidth > mobileOverflow.innerWidth + 1) {
      throw new Error(
        `mobile horizontal overflow: scrollWidth=${mobileOverflow.scrollWidth} > innerWidth=${mobileOverflow.innerWidth}`,
      );
    }

    const report = {
      verdict: 'ACCEPT',
      startedAt,
      completedAt: new Date().toISOString(),
      cloudBase,
      localBase,
      badge,
      commandKeys,
      sawTextDelta: true,
      sawTurnCommitted: true,
      reply,
      consoleErrors,
      pageErrors,
      screenshot: SCREENSHOT_PATH,
      mobileScreenshot: MOBILE_SCREENSHOT_PATH,
    };
    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
    }
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      verdict: report.verdict,
      badge: report.badge,
      commandKeys: report.commandKeys,
      sawTextDelta: report.sawTextDelta,
      sawTurnCommitted: report.sawTurnCommitted,
      replyPreview: reply.slice(0, 240),
      report: REPORT_PATH,
    }, null, 2));
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      body: document.body.innerText.slice(0, 1_500),
      textareaDisabled: document.querySelector('textarea')?.hasAttribute('disabled') ?? null,
    })).catch(() => ({
      body: '(page unavailable)',
      textareaDisabled: null,
    }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}`
      + `\nBrowser diagnostic: ${JSON.stringify({ ...diagnostic, consoleErrors, pageErrors, network })}`
      + `\nVite log:\n${viteLog.slice(-10_000)}`,
    );
  } finally {
    await browser.close();
    await stopChild(vite);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  },
);
