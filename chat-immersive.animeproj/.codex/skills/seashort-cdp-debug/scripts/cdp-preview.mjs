#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';

function findProjectDir(startDir) {
  let dir = realpathSync(resolve(startDir));
  const root = parse(dir).root;
  while (true) {
    if (
      existsSync(join(dir, 'project.json'))
      && existsSync(join(dir, 'src', 'card.json'))
    ) {
      return dir;
    }
    if (dir === root) {
      throw new Error(`Cannot find .animeproj root from ${startDir}`);
    }
    dir = dirname(dir);
  }
}

let cachedProjectDir;
let cachedRuntimeDescriptor;

function getProjectDir() {
  if (!cachedProjectDir) cachedProjectDir = findProjectDir(process.cwd());
  return cachedProjectDir;
}

function getRuntimeDescriptor() {
  if (!cachedRuntimeDescriptor) cachedRuntimeDescriptor = readRuntimeDescriptorSync();
  return cachedRuntimeDescriptor;
}

function defaultCdpPort() {
  if (process.env.SEASHORT_CDP_PORT) return process.env.SEASHORT_CDP_PORT;
  const descriptor = getRuntimeDescriptor();
  return String(descriptor?.cdp?.port || descriptor?.host?.cdpPort || '9222');
}

function readRuntimeDescriptorSync() {
  const projectDir = getProjectDir();
  const runtimePath = join(projectDir, '.seashort', 'runtime.json');
  const fromEnv = {
    projectPath: process.env.SEASHORT_PROJECT_DIR,
    previewUrl: process.env.SEASHORT_PREVIEW_URL,
    frameUrl: process.env.SEASHORT_PREVIEW_FRAME_URL,
    cdpPort: process.env.SEASHORT_CDP_PORT,
  };
  let fromFile = null;
  if (existsSync(runtimePath)) {
    try {
      fromFile = JSON.parse(readFileSync(runtimePath, 'utf8'));
    } catch (error) {
      fromFile = { parseError: error.message };
    }
  }
  const cdpPort = fromEnv.cdpPort
    || fromFile?.cdp?.port
    || fromFile?.host?.cdpPort
    || undefined;
  const previewUrl = fromEnv.previewUrl
    || fromFile?.preview?.url
    || fromFile?.vite?.url
    || fromFile?.staticPreview?.url
    || undefined;
  const frameUrl = fromEnv.frameUrl
    || fromFile?.preview?.frameUrl
    || previewUrl
    || undefined;
  return {
    ...(fromFile && typeof fromFile === 'object' ? fromFile : {}),
    runtimePath,
    projectPath: fromEnv.projectPath || fromFile?.projectPath || projectDir,
    projectDir: fromEnv.projectPath || fromFile?.projectDir || projectDir,
    preview: {
      ...(fromFile?.preview && typeof fromFile.preview === 'object' ? fromFile.preview : {}),
      ...(previewUrl ? { url: previewUrl } : {}),
      ...(frameUrl ? { frameUrl } : {}),
    },
    cdp: {
      ...(fromFile?.cdp && typeof fromFile.cdp === 'object' ? fromFile.cdp : {}),
      host: fromFile?.cdp?.host || fromFile?.host?.cdpHost || '127.0.0.1',
      ...(cdpPort ? { port: String(cdpPort), url: `http://127.0.0.1:${cdpPort}` } : {}),
      enabled: cdpPort !== '0',
    },
    sources: {
      runtimeJson: existsSync(runtimePath),
      env: Object.fromEntries(Object.entries(fromEnv).filter(([, value]) => value != null)),
    },
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  return `Usage:
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs check [--port 9222]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs descriptor [--probe false]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs inspect [--port 9222]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs eval --expr "document.title"
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs html [--selector ".app"]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs snap [--compact false]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs net
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs logs [--duration 3000]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs doctor [--duration 1500]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs click --selector "button"
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs clickxy --x 100 --y 200
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs type --text "hello"
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs viewport --preset mobile [--name mobile.png]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs viewport-suite [--presets desktop,tablet,mobile]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs audit-layout [--preset mobile]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs engine-state
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs flow --file .verify-flows/main.json
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs evalraw --method "Page.getFrameTree" [--params "{}"]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs screenshot [--name shot.png] [--full-page]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs demo [--text "test input"] [--name demo.png]
  node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs lifecycle [--text "test send"] [--timeout 90000] [--name lifecycle.png]
`;
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Cannot connect to ${url}. Restart SeaShort Electron after enabling CDP, or pass --port <port>. ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to ${this.wsUrl}`)), 5000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      this.ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket connection failed: ${this.wsUrl}`));
      }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePromise, reject, method } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(`${method} failed: ${message.error.message}`));
        } else {
          resolvePromise(message.result ?? {});
        }
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject, method });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 15000);
    });
  }

  close() {
    this.ws?.close();
  }
}

async function getTargets(port) {
  return fetchJson(`http://127.0.0.1:${port}/json/list`);
}

async function getVersion(port) {
  return fetchJson(`http://127.0.0.1:${port}/json/version`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function urlPattern(value) {
  if (!value) return null;
  if (value.startsWith('/') && value.endsWith('/') && value.length > 2) {
    return new RegExp(value.slice(1, -1));
  }
  return new RegExp(escapeRegExp(value));
}

function pickElectronPage(targets) {
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  return pages.find((target) => /localhost:1420|127\.0\.0\.1:1420/.test(target.url))
    ?? pages.find((target) => target.title === 'SeaShort')
    ?? pages.find((target) => /seashort/i.test(`${target.title ?? ''} ${target.url ?? ''}`))
    ?? pages[0];
}

async function withPage(port, fn) {
  const targets = await getTargets(port);
  const page = pickElectronPage(targets);
  if (!page) {
    throw new Error(`No debuggable Electron page target found on port ${port}`);
  }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    return await fn(client, page, targets);
  } finally {
    client.close();
  }
}

async function evaluate(client, expression, frameId = undefined, returnByValue = true) {
  let contextId;
  if (frameId) {
    const tree = await client.send('Page.getFrameTree');
    const context = await executionContextForFrame(client, tree.frameTree.frame.id === frameId ? frameId : frameId);
    contextId = context?.id;
  }
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue,
    ...(contextId ? { contextId } : {}),
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Evaluation failed';
    throw new Error(text);
  }
  return result.result;
}

async function executionContextForFrame(client, frameId) {
  await client.send('Runtime.enable');
  const existing = client.events.find((event) =>
    event.method === 'Runtime.executionContextCreated'
    && event.params?.context?.auxData?.frameId === frameId
    && event.params?.context?.auxData?.isDefault,
  );
  if (existing) return existing.params.context;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  const event = client.events.find((candidate) =>
    candidate.method === 'Runtime.executionContextCreated'
    && candidate.params?.context?.auxData?.frameId === frameId
    && candidate.params?.context?.auxData?.isDefault,
  );
  return event?.params?.context;
}

function flattenFrames(frameTree, out = []) {
  out.push(frameTree.frame);
  for (const child of frameTree.childFrames ?? []) {
    flattenFrames(child, out);
  }
  return out;
}

async function getPreviewFrame(client, preferredUrl) {
  const tree = await client.send('Page.getFrameTree');
  const frames = flattenFrames(tree.frameTree);
  const rootUrl = tree.frameTree.frame.url;
  const descriptor = getRuntimeDescriptor();
  const descriptorUrl = descriptor?.preview?.frameUrl || descriptor?.preview?.url;
  const pattern = urlPattern(preferredUrl || descriptorUrl);
  const defaultPattern = /localhost:5273|127\.0\.0\.1:5273/;
  return (pattern ? frames.find((frame) => pattern.test(frame.url)) : undefined)
    ?? frames.find((frame) => defaultPattern.test(frame.url))
    ?? frames.find((frame) => /localhost:\d+|127\.0\.0\.1:\d+/.test(frame.url) && frame.url !== rootUrl && !/localhost:1420|127\.0\.0\.1:1420/.test(frame.url))
    ?? tree.frameTree.frame;
}

async function evaluateInPreview(client, expression, options = {}) {
  const frame = await getPreviewFrame(client, options.frameUrl);
  const context = await executionContextForFrame(client, frame.id);
  if (!context) {
    throw new Error(`No execution context for preview frame ${frame.url}`);
  }
  const result = await client.send('Runtime.evaluate', {
    expression,
    contextId: context.id,
    awaitPromise: true,
    returnByValue: options.returnByValue ?? true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed';
    throw new Error(text);
  }
  return { frame, result: result.result };
}

async function commandCheck(port) {
  const version = await getVersion(port);
  console.log(JSON.stringify({
    ok: true,
    port,
    browser: version.Browser,
    protocolVersion: version['Protocol-Version'],
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
  }, null, 2));
}

async function commandDescriptor(port, args) {
  const probe = args.probe !== 'false';
  const descriptor = getRuntimeDescriptor();
  const projectDir = getProjectDir();
  let cdp = null;
  if (probe && port !== '0') {
    try {
      const version = await getVersion(port);
      cdp = {
        ok: true,
        port,
        browser: version.Browser,
        protocolVersion: version['Protocol-Version'],
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
      };
    } catch (error) {
      cdp = { ok: false, port, error: error.message };
    }
  }
  console.log(JSON.stringify({
    ok: true,
    descriptor,
    effective: {
      projectDir,
      port,
      previewUrl: descriptor?.preview?.url || null,
      frameUrl: descriptor?.preview?.frameUrl || null,
    },
    cdp,
  }, null, 2));
}

async function commandInspect(port) {
  await withPage(port, async (client, page, targets) => {
    const tree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(tree.frameTree).map((frame) => ({
      id: frame.id,
      name: frame.name,
      url: frame.url,
      mimeType: frame.mimeType,
    }));
    const preview = await getPreviewFrame(client);
    const dom = await evaluateInPreview(client, `(() => ({
      title: document.title,
      url: location.href,
      inputs: Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        placeholder: el.getAttribute('placeholder') || '',
        value: 'value' in el ? el.value : el.textContent,
        disabled: !!el.disabled
      })),
      buttons: Array.from(document.querySelectorAll('button')).slice(0, 12).map((el) => el.textContent.trim()),
      scrollY: window.scrollY,
      bodyText: document.body.innerText.slice(0, 500)
    }))();`);
    console.log(JSON.stringify({
      ok: true,
      page: { id: page.id, title: page.title, url: page.url },
      targets: targets.map((target) => ({ id: target.id, type: target.type, title: target.title, url: target.url })),
      frames,
      previewFrame: { id: preview.id, name: preview.name, url: preview.url },
      previewDom: dom.result.value,
    }, null, 2));
  });
}

function expressionFromArgs(args) {
  if (args.expr) return args.expr;
  if (args.file) {
    throw new Error('--file is not implemented; pass --expr for now');
  }
  throw new Error('Missing --expr');
}

async function commandEval(port, args) {
  await withPage(port, async (client) => {
    const { frame, result } = await evaluateInPreview(client, expressionFromArgs(args), {
      frameUrl: args['frame-url'],
      returnByValue: args['return-by-value'] !== 'false',
    });
    console.log(JSON.stringify({
      ok: true,
      frame: { id: frame.id, url: frame.url },
      type: result.type,
      value: result.value,
      description: result.description,
    }, null, 2));
  });
}

function outputPath(name) {
  const projectDir = getProjectDir();
  const filename = name || `cdp-preview-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const path = isAbsolute(filename) ? filename : join(projectDir, '.verify-shots', basename(filename));
  return path;
}

async function screenshot(client, path, args = {}) {
  if (args['full-page']) {
    const metrics = await client.send('Page.getLayoutMetrics');
    const content = metrics.cssContentSize;
    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: content.width, height: content.height, scale: 1 },
    });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(result.data, 'base64'));
    return path;
  }
  const result = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(result.data, 'base64'));
  return path;
}

async function commandScreenshot(port, args) {
  await withPage(port, async (client) => {
    const path = outputPath(args.name);
    await screenshot(client, path, args);
    console.log(JSON.stringify({ ok: true, path }, null, 2));
  });
}

function positional(args, index, flagName) {
  return args[flagName] ?? args._[index];
}

function parseJsonParams(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON params: ${error.message}`);
  }
}

function stringifyRemoteValue(result) {
  if (result.value !== undefined) return result.value;
  return result.description ?? null;
}

function valuePreview(value) {
  if (!value) return null;
  if (value.value !== undefined) return value.value;
  if (value.unserializableValue !== undefined) return value.unserializableValue;
  return value.description ?? value.type ?? null;
}

function eventTimestamp() {
  return new Date().toISOString();
}

async function collectRuntimeEvidence(client, durationMs = 1500, args = {}) {
  const startIndex = client.events.length;
  await client.send('Runtime.enable');
  await client.send('Log.enable').catch(() => {});
  await client.send('Network.enable').catch(() => {});
  await sleep(Math.max(0, durationMs));
  const events = client.events.slice(startIndex);
  const consoleMessages = [];
  const exceptions = [];
  const logEntries = [];
  const failedRequests = [];
  const errorResponses = [];
  const requestUrls = new Map();

  for (const event of events) {
    const params = event.params || {};
    if (event.method === 'Network.requestWillBeSent') {
      requestUrls.set(params.requestId, params.request?.url);
    } else if (event.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push({
        type: params.type,
        text: (params.args || []).map(valuePreview).join(' '),
        args: (params.args || []).map(valuePreview),
        url: params.stackTrace?.callFrames?.[0]?.url || null,
        line: params.stackTrace?.callFrames?.[0]?.lineNumber ?? null,
      });
    } else if (event.method === 'Runtime.exceptionThrown') {
      exceptions.push({
        text: params.exceptionDetails?.text || null,
        description: params.exceptionDetails?.exception?.description || null,
        url: params.exceptionDetails?.url || null,
        line: params.exceptionDetails?.lineNumber ?? null,
        column: params.exceptionDetails?.columnNumber ?? null,
      });
    } else if (event.method === 'Log.entryAdded') {
      logEntries.push({
        level: params.entry?.level,
        source: params.entry?.source,
        text: params.entry?.text,
        url: params.entry?.url || null,
        line: params.entry?.lineNumber ?? null,
      });
    } else if (event.method === 'Network.loadingFailed') {
      failedRequests.push({
        requestId: params.requestId,
        url: requestUrls.get(params.requestId) || null,
        errorText: params.errorText,
        canceled: !!params.canceled,
        type: params.type || null,
      });
    } else if (event.method === 'Network.responseReceived') {
      const status = params.response?.status;
      if (status >= 400) {
        errorResponses.push({
          requestId: params.requestId,
          url: params.response?.url || requestUrls.get(params.requestId) || null,
          status,
          statusText: params.response?.statusText || '',
          type: params.type || null,
        });
      }
    }
  }

  let viteOverlay = null;
  try {
    const { result } = await evaluateInPreview(client, `(() => {
      const overlay = document.querySelector('vite-error-overlay');
      const root = overlay?.shadowRoot || overlay;
      return overlay ? {
        text: (root?.textContent || overlay.textContent || '').trim().slice(0, 4000)
      } : null;
    })();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    viteOverlay = result.value ?? null;
  } catch (error) {
    viteOverlay = { error: error.message };
  }

  return {
    durationMs,
    collectedAt: eventTimestamp(),
    console: consoleMessages,
    exceptions,
    logEntries,
    failedRequests,
    errorResponses,
    viteOverlay,
    eventCount: events.length,
  };
}

async function commandLogs(port, args) {
  const durationMs = Number(args.duration || 3000);
  await withPage(port, async (client, page) => {
    const evidence = await collectRuntimeEvidence(client, durationMs, args);
    console.log(JSON.stringify({
      ok: evidence.exceptions.length === 0 && evidence.failedRequests.length === 0 && evidence.errorResponses.length === 0 && !evidence.viteOverlay,
      page: { id: page.id, title: page.title, url: page.url },
      evidence,
    }, null, 2));
  });
}

function shouldShowAxNode(node, compact) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  if (compact && role === 'InlineTextBox') return false;
  return role !== 'none' && role !== 'generic' && !(name === '' && (value === '' || value == null));
}

function formatAxTree(nodes, compact) {
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const childrenByParent = new Map();
  for (const node of nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId).push(node);
  }

  const lines = [];
  const visited = new Set();
  const visit = (node, depth) => {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    if (shouldShowAxNode(node, compact)) {
      const role = node.role?.value || '';
      const name = node.name?.value ?? '';
      const value = node.value?.value;
      const indent = '  '.repeat(Math.min(depth, 10));
      let line = `${indent}[${role}]`;
      if (name !== '') line += ` ${name}`;
      if (!(value === '' || value == null)) line += ` = ${JSON.stringify(value)}`;
      lines.push(line);
    }
    const children = [];
    const seen = new Set();
    for (const childId of node.childIds || []) {
      const child = nodesById.get(childId);
      if (child && !seen.has(child.nodeId)) {
        seen.add(child.nodeId);
        children.push(child);
      }
    }
    for (const child of childrenByParent.get(node.nodeId) || []) {
      if (!seen.has(child.nodeId)) {
        seen.add(child.nodeId);
        children.push(child);
      }
    }
    for (const child of children) visit(child, depth + 1);
  };

  for (const root of nodes.filter((node) => !node.parentId || !nodesById.has(node.parentId))) {
    visit(root, 0);
  }
  for (const node of nodes) visit(node, 0);
  return lines.join('\n');
}

async function commandHtml(port, args) {
  await withPage(port, async (client) => {
    const selector = positional(args, 1, 'selector');
    const expression = selector
      ? `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return el ? el.outerHTML : null;
        })();`
      : 'document.documentElement.outerHTML';
    const { frame, result } = await evaluateInPreview(client, expression, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    console.log(JSON.stringify({
      ok: true,
      frame: { id: frame.id, url: frame.url },
      selector: selector || null,
      html: stringifyRemoteValue(result),
    }, null, 2));
  });
}

async function commandNet(port, args) {
  await withPage(port, async (client) => {
    const { frame, result } = await evaluateInPreview(client, `(() => performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      type: entry.initiatorType,
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize || 0,
      decodedBodySize: entry.decodedBodySize || 0
    })))();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    console.log(JSON.stringify({
      ok: true,
      frame: { id: frame.id, url: frame.url },
      resources: result.value,
    }, null, 2));
  });
}

const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false },
  laptop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  narrow: { width: 360, height: 780, deviceScaleFactor: 2, mobile: true },
};

function parseViewport(args) {
  const presetName = String(args.preset || 'desktop');
  const preset = VIEWPORT_PRESETS[presetName] || VIEWPORT_PRESETS.desktop;
  return {
    name: presetName,
    width: Number(args.width || preset.width),
    height: Number(args.height || preset.height),
    deviceScaleFactor: Number(args.dpr || args.deviceScaleFactor || preset.deviceScaleFactor || 1),
    mobile: args.mobile != null ? args.mobile !== 'false' : !!preset.mobile,
  };
}

async function setViewport(client, viewport) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
}

async function commandViewport(port, args) {
  const viewport = parseViewport(args);
  await withPage(port, async (client) => {
    await setViewport(client, viewport);
    await sleep(Number(args.wait || 350));
    const path = outputPath(args.name || `viewport-${viewport.name}-${Date.now()}.png`);
    await screenshot(client, path, args);
    console.log(JSON.stringify({
      ok: true,
      viewport,
      screenshot: path,
    }, null, 2));
  });
}

function parseList(raw, fallback) {
  if (!raw) return fallback;
  return String(raw).split(',').map((item) => item.trim()).filter(Boolean);
}

async function commandViewportSuite(port, args) {
  const presets = parseList(args.presets, ['desktop', 'tablet', 'mobile']);
  const waitMs = Number(args.wait || 350);
  const results = [];
  await withPage(port, async (client) => {
    for (const preset of presets) {
      const viewport = parseViewport({ ...args, preset });
      await setViewport(client, viewport);
      await sleep(waitMs);
      const path = outputPath(args.name ? `${basename(args.name, '.png')}-${preset}.png` : `viewport-${preset}-${Date.now()}.png`);
      await screenshot(client, path, args);
      const audit = await layoutAudit(client, { ...args, preset });
      results.push({
        preset,
        viewport,
        screenshot: path,
        audit: audit.summary,
      });
    }
  });
  console.log(JSON.stringify({
    ok: results.every((item) => (item.audit?.errorCount || 0) === 0),
    results,
  }, null, 2));
}

async function layoutAudit(client, args = {}) {
  const { frame, result } = await evaluateInPreview(client, `(() => {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    };
    const nodes = Array.from(document.querySelectorAll('body *'));
    const visible = nodes.map((el, index) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      const selector = (() => {
        if (el.id) return '#' + CSS.escape(el.id);
        const cls = Array.from(el.classList || []).slice(0, 3).map((item) => '.' + CSS.escape(item)).join('');
        return el.tagName.toLowerCase() + cls;
      })();
      return {
        index,
        selector,
        tag: el.tagName.toLowerCase(),
        text,
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        fixed: style.position === 'fixed' || style.position === 'sticky',
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity || '1'),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        color: style.color,
        backgroundColor: style.backgroundColor,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom)
        },
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    }).filter((item) =>
      item.display !== 'none'
      && item.visibility !== 'hidden'
      && item.opacity !== 0
      && item.rect.width > 0
      && item.rect.height > 0
    );

    const issues = [];
    const add = (severity, type, item, detail) => issues.push({ severity, type, selector: item.selector, tag: item.tag, text: item.text, rect: item.rect, detail });
    for (const item of visible) {
      const r = item.rect;
      if (r.right > viewport.width + 1 || r.x < -1) add('error', 'horizontal-overflow', item, \`viewport=\${viewport.width}\`);
      if (item.scrollWidth > item.clientWidth + 2 && !['auto', 'scroll'].includes(item.overflowX)) add('warn', 'content-clipped-x', item, \`scrollWidth=\${item.scrollWidth}, clientWidth=\${item.clientWidth}\`);
      if (item.scrollHeight > item.clientHeight + 2 && !['auto', 'scroll'].includes(item.overflowY)) add('warn', 'content-clipped-y', item, \`scrollHeight=\${item.scrollHeight}, clientHeight=\${item.clientHeight}\`);
      const clickable = item.tag === 'button' || item.role === 'button' || item.tag === 'a';
      if (clickable && (r.width < 32 || r.height < 32)) add('warn', 'small-click-target', item, 'target below 32 CSS px');
      if ((item.tag === 'input' || item.tag === 'textarea') && !item.ariaLabel) {
        const id = nodes[item.index]?.id;
        const hasLabel = id ? !!document.querySelector(\`label[for="\${CSS.escape(id)}"]\`) : false;
        if (!hasLabel) add('info', 'unlabeled-input', item, 'input has no label or aria-label');
      }
    }

    const important = visible.filter((item) => {
      if (item.rect.y >= viewport.height || item.rect.bottom <= 0) return false;
      if (item.rect.width * item.rect.height < 900) return false;
      return item.tag === 'button' || item.tag === 'textarea' || item.tag === 'input' || item.fixed || item.text.length > 0;
    }).slice(0, 160);
    for (let i = 0; i < important.length; i += 1) {
      for (let j = i + 1; j < important.length; j += 1) {
        const a = important[i];
        const b = important[j];
        if (a.selector === b.selector) continue;
        const aNode = nodes[a.index];
        const bNode = nodes[b.index];
        if (aNode && bNode && (aNode.contains(bNode) || bNode.contains(aNode))) continue;
        const x = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.x, b.rect.x));
        const y = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.y, b.rect.y));
        const area = x * y;
        const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
        if (area > 0 && minArea > 0 && area / minArea > 0.65) {
          if (a.fixed || b.fixed) {
            issues.push({ severity: 'warn', type: 'possible-fixed-overlap', a: a.selector, b: b.selector, aRect: a.rect, bRect: b.rect });
          }
        }
      }
    }

    const rawColorRe = /#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\(/g;
    const cssText = Array.from(document.styleSheets).map((sheet) => {
      try {
        return Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join('\\n');
      } catch {
        return '';
      }
    }).join('\\n');
    const rawColorMatches = Array.from(new Set((cssText.match(rawColorRe) || []))).slice(0, 80);
    return {
      url: location.href,
      title: document.title,
      viewport,
      summary: {
        visibleNodes: visible.length,
        issueCount: issues.length,
        errorCount: issues.filter((item) => item.severity === 'error').length,
        warnCount: issues.filter((item) => item.severity === 'warn').length,
        rawColorCount: rawColorMatches.length
      },
      issues: issues.slice(0, 120),
      rawColors: rawColorMatches,
      bodyText: document.body.innerText.slice(0, 1000)
    };
  })();`, {
    frameUrl: args['frame-url'],
    returnByValue: true,
  });
  return { frame, audit: result.value, summary: result.value?.summary || {} };
}

async function commandAuditLayout(port, args) {
  const viewport = parseViewport(args);
  await withPage(port, async (client) => {
    if (args.preset || args.width || args.height) {
      await setViewport(client, viewport);
      await sleep(Number(args.wait || 250));
    }
    const { frame, audit } = await layoutAudit(client, args);
    console.log(JSON.stringify({
      ok: (audit?.summary?.errorCount || 0) === 0,
      frame: { id: frame.id, url: frame.url },
      viewport,
      audit,
    }, null, 2));
  });
}

async function commandSnap(port, args) {
  await withPage(port, async (client) => {
    const frame = await getPreviewFrame(client, args['frame-url']);
    let nodes;
    try {
      const result = await client.send('Accessibility.getFullAXTree', { frameId: frame.id });
      nodes = result.nodes || [];
    } catch {
      const result = await client.send('Accessibility.getFullAXTree');
      nodes = result.nodes || [];
    }
    const compact = args.compact !== 'false';
    console.log(JSON.stringify({
      ok: true,
      frame: { id: frame.id, url: frame.url },
      compact,
      snapshot: formatAxTree(nodes, compact),
    }, null, 2));
  });
}

async function commandClick(port, args) {
  const selector = positional(args, 1, 'selector');
  if (!selector) throw new Error('Missing --selector');
  await withPage(port, async (client) => {
    const { frame, result } = await evaluateInPreview(client, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return {
        ok: true,
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || el.value || '').trim().slice(0, 160)
      };
    })();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    if (!result.value?.ok) throw new Error(result.value?.error || `Cannot click ${selector}`);
    console.log(JSON.stringify({
      ok: true,
      frame: { id: frame.id, url: frame.url },
      selector,
      action: result.value,
    }, null, 2));
  });
}

async function commandClickXy(port, args) {
  const x = Number(positional(args, 1, 'x'));
  const y = Number(positional(args, 2, 'y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Missing numeric --x and --y CSS pixel coordinates');
  }
  await withPage(port, async (client) => {
    const base = { x, y, button: 'left', clickCount: 1, modifiers: 0 };
    await client.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
    await client.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await sleep(50);
    await client.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
    console.log(JSON.stringify({ ok: true, x, y }, null, 2));
  });
}

async function commandType(port, args) {
  const text = positional(args, 1, 'text');
  if (!text) throw new Error('Missing --text');
  await withPage(port, async (client) => {
    await client.send('Input.insertText', { text: String(text) });
    console.log(JSON.stringify({ ok: true, characters: String(text).length }, null, 2));
  });
}

async function commandEvalRaw(port, args) {
  const method = positional(args, 1, 'method');
  if (!method) throw new Error('Missing --method');
  const params = parseJsonParams(positional(args, 2, 'params'));
  await withPage(port, async (client) => {
    const result = await client.send(method, params);
    console.log(JSON.stringify({ ok: true, method, result }, null, 2));
  });
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function truthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

async function setValueInPreview(client, selector, text, args = {}) {
  const { frame, result } = await evaluateInPreview(client, `(async () => {
    const selector = ${jsString(selector)};
    const value = ${jsString(text)};
    const fields = selector
      ? [document.querySelector(selector)].filter(Boolean)
      : Array.from(document.querySelectorAll('textarea, input:not([type="hidden"]), [contenteditable="true"]'));
    const target = fields[0];
    if (!target) return { ok: false, error: selector ? \`element not found: \${selector}\` : 'no input found' };
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.focus();
    if (target.isContentEditable) {
      target.textContent = value;
    } else {
      const proto = target instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : target instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(target, value);
      else target.value = value;
    }
    try {
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      ok: true,
      selector,
      tag: target.tagName.toLowerCase(),
      value: target.isContentEditable ? target.textContent : target.value,
      text: (target.innerText || target.textContent || '').trim().slice(0, 160)
    };
  })();`, {
    frameUrl: args['frame-url'],
    returnByValue: true,
  });
  if (!result.value?.ok) throw new Error(result.value?.error || 'set value failed');
  return { frame, action: result.value };
}

async function waitForCondition(client, step, args = {}) {
  const timeoutMs = Number(step.timeout || args.timeout || 10000);
  const intervalMs = Number(step.interval || 250);
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt <= timeoutMs) {
    const expression = (() => {
      if (step.selector) {
        return `(() => {
          const el = document.querySelector(${jsString(step.selector)});
          return { ok: !!el, text: el ? (el.innerText || el.textContent || el.value || '').trim() : '' };
        })();`;
      }
      if (step.text) {
        return `(() => {
          const text = ${jsString(step.text)};
          return { ok: document.body.innerText.includes(text), text: document.body.innerText.slice(0, 500) };
        })();`;
      }
      if (step.expr) {
        return `(() => {
          const value = (${step.expr});
          return { ok: !!value, value };
        })();`;
      }
      if (step.engine === 'idle') {
        return `(() => {
          const snap = window.__SEASHORT_DEBUG__?.getSnapshot?.() || window.__engine?.getSnapshot?.();
          return { ok: !!snap && !snap.streaming, streaming: !!snap?.streaming, messages: snap?.messages?.length || 0 };
        })();`;
      }
      return `(() => ({ ok: true }))();`;
    })();
    const { result } = await evaluateInPreview(client, expression, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    last = result.value;
    if (last?.ok) return last;
    await sleep(intervalMs);
  }
  throw new Error(`wait step timed out: ${JSON.stringify(step)} last=${JSON.stringify(last)}`);
}

async function previewState(client, args = {}) {
  const { frame, result } = await evaluateInPreview(client, `(() => {
    const snap = window.__SEASHORT_DEBUG__?.getSnapshot?.() || window.__engine?.getSnapshot?.();
    const messages = snap?.messages || [];
    const sendButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '发送');
    const textarea = document.querySelector('.composer textarea') || document.querySelector('textarea');
    const flow = document.querySelector('.chat-flow');
    return {
      hasEngine: !!window.__engine,
      messages: messages.length,
      roles: messages.map((message) => message.role),
      lastRole: messages.at(-1)?.role || null,
      streaming: !!snap?.streaming,
      errorText: document.querySelector('.dialog-error')?.innerText || '',
      composer: {
        value: textarea?.value || '',
        placeholder: textarea?.placeholder || '',
        sendDisabled: sendButton ? !!sendButton.disabled : null
      },
      scroll: flow ? {
        top: flow.scrollTop,
        height: flow.scrollHeight,
        client: flow.clientHeight
      } : null,
      bodyText: document.body.innerText.slice(0, 800)
    };
  })();`, {
    frameUrl: args['frame-url'],
    returnByValue: true,
  });
  return { frame, state: result.value };
}

async function engineState(client, args = {}) {
  const { frame, result } = await evaluateInPreview(client, `(() => {
    const debug = window.__SEASHORT_DEBUG__;
    const snap = debug?.getSnapshot?.() || window.__engine?.getSnapshot?.();
    const variables = debug?.getVariables?.() || null;
    const messages = snap?.messages || [];
    return {
      hasDebugBridge: !!debug,
      hasEngine: !!window.__engine || !!debug,
      url: location.href,
      title: document.title,
      messages: messages.map((message, index) => ({
        index,
        role: message.role,
        contentPreview: String(message.content || '').slice(0, 240),
        contentLength: String(message.content || '').length
      })),
      messageCount: messages.length,
      lastRole: messages.at(-1)?.role || null,
      streaming: !!snap?.streaming,
      state: snap?.state || null,
      options: snap?.options || [],
      lastRender: snap?.lastRender ? {
        hasHtml: !!snap.lastRender.html,
        htmlPreview: String(snap.lastRender.html || '').slice(0, 500),
        isInteractive: !!snap.lastRender.isInteractive,
        hasSrcdoc: !!snap.lastRender.srcdoc
      } : null,
      timing: snap?.timing || null,
      variables
    };
  })();`, {
    frameUrl: args['frame-url'],
    returnByValue: true,
  });
  return { frame, state: result.value };
}

async function commandEngineState(port, args) {
  await withPage(port, async (client) => {
    const { frame, state } = await engineState(client, args);
    console.log(JSON.stringify({
      ok: !!state?.hasEngine,
      frame: { id: frame.id, url: frame.url },
      state,
    }, null, 2));
  });
}

async function commandDemo(port, args) {
  const text = args.text || '这是 Codex 通过 CDP 写入的预览测试文本，不发送。';
  await withPage(port, async (client) => {
    const { frame, result } = await evaluateInPreview(client, `(async () => {
      window.scrollBy({ top: 360, behavior: 'instant' });
      const fields = Array.from(document.querySelectorAll('textarea, input:not([type="hidden"]), [contenteditable="true"]'));
      const target = fields.find((el) => (el.getAttribute('placeholder') || '').includes('说点什么'))
        || fields.find((el) => el.tagName.toLowerCase() === 'textarea')
        || fields[0];
      if (!target) return { ok: false, reason: 'no input found', scrollY: window.scrollY };
      const value = ${jsString(text)};
      target.focus();
      if (target.isContentEditable) {
        target.textContent = value;
      } else {
        const proto = target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : target instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : null;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(target, value);
        else target.value = value;
      }
      try {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      } catch {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sendButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '发送');
      return {
        ok: true,
        tag: target.tagName.toLowerCase(),
        placeholder: target.getAttribute('placeholder') || '',
        value: target.isContentEditable ? target.textContent : target.value,
        sendDisabled: sendButton ? sendButton.disabled : null,
        scrollY: window.scrollY
      };
    })();`);
    const path = outputPath(args.name || `cdp-demo-${Date.now()}.png`);
    await screenshot(client, path, args);
    console.log(JSON.stringify({
      ok: true,
      frame: { id: frame.id, url: frame.url },
      action: result.value,
      screenshot: path,
    }, null, 2));
  });
}

async function loadFlowFile(path) {
  const projectDir = getProjectDir();
  const absPath = isAbsolute(path) ? path : join(projectDir, path);
  const raw = await readFile(absPath, 'utf8');
  const parsed = JSON.parse(raw);
  const steps = Array.isArray(parsed) ? parsed : parsed.steps;
  if (!Array.isArray(steps)) {
    throw new Error(`Flow file must contain an array or { "steps": [] }: ${path}`);
  }
  return { path: absPath, name: parsed.name || basename(path), steps };
}

async function runFlowStep(client, step, index, args = {}) {
  const type = step.type || step.action;
  if (!type) throw new Error(`Flow step ${index} missing type`);
  if (type === 'wait') {
    await sleep(Number(step.ms || step.duration || 1000));
    return { ok: true, type, waitedMs: Number(step.ms || step.duration || 1000) };
  }
  if (type === 'waitSelector' || type === 'waitForSelector') {
    const result = await waitForCondition(client, { ...step, selector: step.selector }, args);
    return { ok: true, type, result };
  }
  if (type === 'waitText') {
    const result = await waitForCondition(client, { ...step, text: step.text }, args);
    return { ok: true, type, result };
  }
  if (type === 'waitExpr') {
    const result = await waitForCondition(client, { ...step, expr: step.expr }, args);
    return { ok: true, type, result };
  }
  if (type === 'waitEngineIdle') {
    const result = await waitForCondition(client, { ...step, engine: 'idle' }, args);
    return { ok: true, type, result };
  }
  if (type === 'click') {
    const selector = step.selector;
    if (!selector) throw new Error(`Flow step ${index} click missing selector`);
    const { result } = await evaluateInPreview(client, `(() => {
      const el = document.querySelector(${jsString(selector)});
      if (!el) return { ok: false, error: 'element not found' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { ok: true, text: (el.innerText || el.textContent || el.value || '').trim().slice(0, 160) };
    })();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    if (!result.value?.ok) throw new Error(result.value?.error || `click failed: ${selector}`);
    return { ok: true, type, selector, result: result.value };
  }
  if (type === 'fill' || type === 'type') {
    const value = step.text ?? step.value ?? '';
    const result = await setValueInPreview(client, step.selector, value, args);
    return { ok: true, type, selector: step.selector || null, result: result.action };
  }
  if (type === 'scroll') {
    const top = Number(step.top ?? step.y ?? 0);
    const by = Number(step.by ?? 0);
    const { result } = await evaluateInPreview(client, `(() => {
      const selector = ${step.selector ? jsString(step.selector) : 'null'};
      const el = selector ? document.querySelector(selector) : document.scrollingElement;
      if (!el) return { ok: false, error: 'scroll target not found' };
      if (${Number.isFinite(by) && by !== 0}) el.scrollBy({ top: ${by}, behavior: 'instant' });
      else el.scrollTo({ top: ${top}, behavior: 'instant' });
      return { ok: true, top: el.scrollTop || window.scrollY };
    })();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    if (!result.value?.ok) throw new Error(result.value?.error || 'scroll failed');
    return { ok: true, type, result: result.value };
  }
  if (type === 'eval') {
    const { result } = await evaluateInPreview(client, step.expr, {
      frameUrl: args['frame-url'],
      returnByValue: step.returnByValue !== false,
    });
    return { ok: true, type, result: stringifyRemoteValue(result) };
  }
  if (type === 'screenshot') {
    const path = outputPath(step.name || `flow-${index}-${Date.now()}.png`);
    await screenshot(client, path, { ...args, ...step });
    return { ok: true, type, screenshot: path };
  }
  if (type === 'auditLayout') {
    const audit = await layoutAudit(client, { ...args, ...step });
    return { ok: (audit.summary?.errorCount || 0) === 0, type, audit: audit.audit };
  }
  if (type === 'engineState') {
    const state = await engineState(client, args);
    return { ok: !!state.state?.hasEngine, type, state: state.state };
  }
  throw new Error(`Unknown flow step type: ${type}`);
}

async function commandFlow(port, args) {
  const file = args.file || positional(args, 1, 'file');
  if (!file) throw new Error('Missing --file');
  const flow = await loadFlowFile(file);
  const results = [];
  await withPage(port, async (client) => {
    for (let i = 0; i < flow.steps.length; i += 1) {
      const step = flow.steps[i];
      const startedAt = Date.now();
      try {
        const result = await runFlowStep(client, step, i, args);
        results.push({ index: i, step, ok: result.ok !== false, elapsedMs: Date.now() - startedAt, result });
        if (result.ok === false && step.continueOnError !== true) {
          throw new Error(`Flow step ${i} returned ok=false`);
        }
      } catch (error) {
        results.push({ index: i, step, ok: false, elapsedMs: Date.now() - startedAt, error: error.message });
        if (!truthy(step.continueOnError)) break;
      }
    }
  });
  const ok = results.length === flow.steps.length && results.every((item) => item.ok);
  console.log(JSON.stringify({
    ok,
    flow: { name: flow.name, path: flow.path, steps: flow.steps.length },
    results,
  }, null, 2));
}

async function commandLifecycle(port, args) {
  const text = args.text || '请用一句话回应当前剧情状态。';
  const timeoutMs = Number(args.timeout || 90000);
  await withPage(port, async (client) => {
    const before = await previewState(client, args);
    const { frame, result } = await evaluateInPreview(client, `(async () => {
      const setNativeValue = (target, value) => {
        if (!target) return false;
        target.focus();
        if (target.isContentEditable) {
          target.textContent = value;
        } else {
          const proto = target instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : target instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : null;
          const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(target, value);
          else target.value = value;
        }
        try {
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        } catch {
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const flow = document.querySelector('.chat-flow');
      if (flow) flow.scrollTop = flow.scrollHeight;
      const target = document.querySelector('.composer textarea')
        || Array.from(document.querySelectorAll('textarea')).find((el) => (el.getAttribute('placeholder') || '').includes('说点什么'))
        || document.querySelector('textarea');
      const value = ${jsString(text)};
      const filled = setNativeValue(target, value);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sendButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '发送');
      const beforeClick = {
        filled,
        value: target?.value || target?.textContent || '',
        sendDisabled: sendButton ? !!sendButton.disabled : null
      };
      if (!filled) return { ok: false, beforeClick, error: 'composer textarea not found' };
      if (!sendButton) return { ok: false, beforeClick, error: 'send button not found' };
      if (sendButton.disabled) return { ok: false, beforeClick, error: 'send button is disabled after fill' };
      sendButton.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { ok: true, beforeClick };
    })();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    });
    if (!result.value?.ok) throw new Error(result.value?.error || 'Lifecycle send failed');

    const startedAt = Date.now();
    let final = await previewState(client, args);
    while (Date.now() - startedAt < timeoutMs) {
      final = await previewState(client, args);
      const state = final.state;
      if (state.errorText) break;
      if (
        state.hasEngine
        && !state.streaming
        && state.messages >= (before.state.messages + 2)
        && state.lastRole === 'assistant'
      ) {
        break;
      }
      await sleep(1000);
    }

    const completed = final.state.hasEngine
      && !final.state.streaming
      && final.state.messages >= (before.state.messages + 2)
      && final.state.lastRole === 'assistant'
      && !final.state.errorText;
    const path = outputPath(args.name || `cdp-lifecycle-${Date.now()}.png`);
    await screenshot(client, path, args);
    console.log(JSON.stringify({
      ok: completed,
      frame: { id: frame.id, url: frame.url },
      before: before.state,
      action: result.value,
      final: final.state,
      timeoutMs,
      screenshot: path,
      error: completed ? undefined : (final.state.errorText || 'Lifecycle did not complete before timeout'),
    }, null, 2));
  });
}

async function commandDoctor(port, args) {
  const durationMs = Number(args.duration || 1500);
  const descriptor = getRuntimeDescriptor();
  await withPage(port, async (client, page, targets) => {
    const tree = await client.send('Page.getFrameTree');
    const frames = flattenFrames(tree.frameTree).map((frame) => ({
      id: frame.id,
      name: frame.name,
      url: frame.url,
      mimeType: frame.mimeType,
    }));
    const preview = await getPreviewFrame(client, args['frame-url']);
    const [state, audit, evidence] = await Promise.all([
      engineState(client, args).catch((error) => ({ error: error.message })),
      layoutAudit(client, args).catch((error) => ({ audit: null, summary: { error: error.message } })),
      collectRuntimeEvidence(client, durationMs, args).catch((error) => ({ error: error.message })),
    ]);
    const net = await evaluateInPreview(client, `(() => performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      type: entry.initiatorType,
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize || 0,
      decodedBodySize: entry.decodedBodySize || 0
    })).slice(-120))();`, {
      frameUrl: args['frame-url'],
      returnByValue: true,
    }).catch((error) => ({ result: { value: null }, error: error.message }));
    const problems = [];
    const warnings = [];
    if (state.error) problems.push({ type: 'engine-state-error', error: state.error });
    if (state.state && !state.state.hasEngine) problems.push({ type: 'engine-missing' });
    if (audit.summary?.error) problems.push({ type: 'layout-audit-error', error: audit.summary.error });
    if (audit.summary?.errorCount > 0) problems.push({ type: 'layout-errors', count: audit.summary.errorCount });
    if (audit.summary?.warnCount > 0) warnings.push({ type: 'layout-warnings', count: audit.summary.warnCount });
    if (evidence.error) problems.push({ type: 'runtime-evidence-error', error: evidence.error });
    if (evidence.exceptions?.length) problems.push({ type: 'runtime-exceptions', count: evidence.exceptions.length });
    if (evidence.failedRequests?.length) problems.push({ type: 'failed-requests', count: evidence.failedRequests.length });
    if (evidence.errorResponses?.length) problems.push({ type: 'error-responses', count: evidence.errorResponses.length });
    if (evidence.viteOverlay) problems.push({ type: 'vite-overlay' });
    console.log(JSON.stringify({
      ok: problems.length === 0,
      descriptor,
      page: { id: page.id, title: page.title, url: page.url },
      targets: targets.map((target) => ({ id: target.id, type: target.type, title: target.title, url: target.url })),
      frames,
      previewFrame: { id: preview.id, name: preview.name, url: preview.url },
      engineState: state.state || null,
      layout: audit.audit || null,
      runtimeEvidence: evidence,
      resources: net.result?.value || null,
      problems,
      warnings,
    }, null, 2));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    console.log(usage());
    return;
  }
  const port = String(args.port || defaultCdpPort());
  if (port === '0') {
    throw new Error('SEASHORT_CDP_PORT is 0; CDP is disabled');
  }
  if (command === 'check') return commandCheck(port);
  if (command === 'descriptor') return commandDescriptor(port, args);
  if (command === 'inspect') return commandInspect(port);
  if (command === 'eval') return commandEval(port, args);
  if (command === 'html') return commandHtml(port, args);
  if (command === 'snap') return commandSnap(port, args);
  if (command === 'net') return commandNet(port, args);
  if (command === 'logs') return commandLogs(port, args);
  if (command === 'doctor') return commandDoctor(port, args);
  if (command === 'click') return commandClick(port, args);
  if (command === 'clickxy') return commandClickXy(port, args);
  if (command === 'type') return commandType(port, args);
  if (command === 'viewport') return commandViewport(port, args);
  if (command === 'viewport-suite') return commandViewportSuite(port, args);
  if (command === 'audit-layout') return commandAuditLayout(port, args);
  if (command === 'engine-state') return commandEngineState(port, args);
  if (command === 'flow') return commandFlow(port, args);
  if (command === 'evalraw') return commandEvalRaw(port, args);
  if (command === 'screenshot') return commandScreenshot(port, args);
  if (command === 'demo') return commandDemo(port, args);
  if (command === 'lifecycle') return commandLifecycle(port, args);
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
