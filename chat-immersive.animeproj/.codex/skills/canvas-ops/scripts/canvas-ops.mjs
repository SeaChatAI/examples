#!/usr/bin/env node
// canvas-ops.mjs — drive the SeaShort infinite canvas from an agent without the
// curl inline-JSON escaping papercut. Talks to bun-server /rpc (canvas_bridge_*)
// using structured flags, and can screenshot the canvas via CDP in dev.
//
// Env (injected into the SeaCraft agent subprocess by the Electron host):
//   SEASHORT_RPC_BASE, SEASHORT_RPC_TOKEN  — required for all ops
//   SEASHORT_CDP_PORT                       — enables `shot` (dev only; empty in packaged app)
//
// Subcommands:
//   status                      list connected canvas clients
//   state [--summary] [--json <ops.json>]  read snapshot (summary strips big metadata)
//   apply --file <ops.json> | --ops '<json>'   apply raw ops array
//   add --type text --title T --content C --x 100 --y 200 [--id ID]   convenience add_node
//   connect --from A --to B     connect two nodes
//   gen --node ID [--mode image] [--prompt P] [--wait] [--timeout 180]  run_generation (+poll)
//   fit [--ids a,b,c] [--padding 80]         fit_view (all nodes or a subset)
//   focus --node ID [--zoom 1]  center a node
//   upload --node ID --url <URL> | --data-url <dataURL>   put an asset into a media node
//   shot [--name f.png]         screenshot the canvas via CDP (dev only)
//
// The op vocabulary and snapshot shape are documented in ../SKILL.md.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

// /rpc is always loopback. Dev shells often set http(s)_proxy=127.0.0.1:7890 for
// outbound access, and Node's fetch (undici) can route these loopback calls through
// it, causing intermittent "fetch failed". Bypass the proxy for loopback.
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost,127.0.0.1,::1'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

const RPC_BASE = (process.env.SEASHORT_RPC_BASE || '').replace(/\/$/, '');
const RPC_TOKEN = process.env.SEASHORT_RPC_TOKEN || '';
const CDP_PORT = process.env.SEASHORT_CDP_PORT || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function rpc(command, args = {}, attempts = 3) {
  if (!RPC_BASE) throw new Error('SEASHORT_RPC_BASE not set — run inside the SeaShort agent (canvas driving needs the host).');
  const url = `${RPC_BASE}/rpc`;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-seashort-token': RPC_TOKEN },
        body: JSON.stringify({ command, args }),
      });
      const json = await res.json();
      if (json && json.ok === false) throw new Error(json.error || `rpc ${command} failed`);
      return json.data;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await sleep(150 * (i + 1));
    }
  }
  throw new Error(`rpc ${command}: ${lastError?.message ?? lastError}`);
}

// Project a full snapshot into a compact, agent-friendly view: strip large
// metadata (blob/data URLs), keep the structure + human-readable connections.
function summarize(state) {
  const nodes = (state.nodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    pos: n.position,
    size: { w: n.width, h: n.height },
    status: n.metadata?.status,
    hasContent: Boolean(n.metadata?.content),
    prompt: n.metadata?.prompt || n.metadata?.composerContent || undefined,
  }));
  const titleOf = (id) => (state.nodes || []).find((n) => n.id === id)?.title || id;
  const connections = (state.connections || []).map((c) => ({ id: c.id, from: `${c.fromNodeId}(${titleOf(c.fromNodeId)})`, to: `${c.toNodeId}(${titleOf(c.toNodeId)})` }));
  const xs = (state.nodes || []).flatMap((n) => [n.position.x, n.position.x + n.width]);
  const ys = (state.nodes || []).flatMap((n) => [n.position.y, n.position.y + n.height]);
  const bounds = xs.length ? { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) } : null;
  return { projectId: state.projectId, title: state.title, nodeCount: nodes.length, selected: state.selectedNodeIds, viewport: state.viewport, bounds, nodes, connections };
}

function out(v) {
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}

async function readOps(args) {
  if (args.ops) return JSON.parse(args.ops);
  if (args.file) {
    const path = isAbsolute(args.file) ? args.file : join(process.cwd(), args.file);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  throw new Error('apply needs --ops \'<json>\' or --file <path>');
}

async function cdpConnect(wsUrl) {
  const { default: WsDep } = await import('ws').catch(() => ({ default: null }));
  const WS = WsDep || globalThis.WebSocket;
  if (!WS) throw new Error('WebSocket unavailable; cannot screenshot.');
  const ws = new WS(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (m) => { const o = JSON.parse(m.data); if (o.id && pending.has(o.id)) { pending.get(o.id)(o); pending.delete(o.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP ws error')); });
  return { send, close: () => ws.close() };
}

async function shotViaCdp(name) {
  if (!CDP_PORT) throw new Error('SEASHORT_CDP_PORT not set — screenshots need the dev host (CDP). Use `state --summary` to inspect instead.');
  const base = `http://127.0.0.1:${CDP_PORT}`;
  const targets = await (await fetch(`${base}/json`)).json();
  // Screenshot the HOST page surface (it composites the visible canvas iframe).
  // Capturing the out-of-process canvas target directly returns empty data.
  const host = targets.find((t) => t.type === 'page' && /:1420\//.test(t.url) && t.webSocketDebuggerUrl);
  if (!host) throw new Error('No host page CDP target (dev app not running with CDP?).');
  const { send, close } = await cdpConnect(host.webSocketDebuggerUrl);
  try {
    await send('Runtime.enable');
    // Make sure the WebIDE 画布 view is the active tab so the canvas is visible.
    await send('Runtime.evaluate', {
      expression: `(() => { const b = Array.from(document.querySelectorAll('.webide-viewtab')).find((x) => (x.getAttribute('title')||'') === '画布'); if (b) b.click(); return !!b; })()`,
      returnByValue: true,
    });
    await sleep(1500);
    await send('Page.enable');
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    if (!shot.result?.data) throw new Error('captureScreenshot returned no data (canvas view may not be visible)');
    const filename = name || `canvas-${Date.now()}.png`;
    const path = isAbsolute(filename) ? filename : join(process.cwd(), '.verify-shots', filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(shot.result.data, 'base64'));
    return path;
  } finally {
    close();
  }
}

function usage() {
  return `canvas-ops.mjs — drive the SeaShort infinite canvas
  status
  state [--summary]
  apply --ops '<json array>' | --file ops.json
  add --type text|image|video|audio|config [--title T] [--content C] [--x N --y N] [--id ID]
  connect --from ID --to ID
  gen --node ID [--mode text|image|video|audio] [--prompt P] [--wait] [--timeout 180]
  fit [--ids a,b,c] [--padding 80] [--max-zoom 2]
  focus --node ID [--zoom 1]
  upload --node ID --url URL | --data-url DATAURL [--mime image/png]
  shot [--name file.png]        (dev only; needs SEASHORT_CDP_PORT)
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || args.help) return out(usage());

  if (cmd === 'status') return out(await rpc('canvas_bridge_status'));

  if (cmd === 'state') {
    const state = await rpc('canvas_bridge_get_state', args.client ? { clientId: args.client } : {});
    return out(args.summary ? summarize(state) : state);
  }

  if (cmd === 'apply') {
    const ops = await readOps(args);
    return out(summarize(await rpc('canvas_bridge_apply_ops', { ops })));
  }

  if (cmd === 'add') {
    const op = { type: 'add_node', nodeType: args.type || 'text' };
    if (args.id) op.id = args.id;
    if (args.title) op.title = args.title;
    if (args.x != null || args.y != null) op.position = { x: Number(args.x) || 0, y: Number(args.y) || 0 };
    if (args.content) op.metadata = { content: args.content };
    return out(summarize(await rpc('canvas_bridge_apply_ops', { ops: [op] })));
  }

  if (cmd === 'connect') {
    if (!args.from || !args.to) throw new Error('connect needs --from and --to');
    return out(summarize(await rpc('canvas_bridge_apply_ops', { ops: [{ type: 'connect_nodes', fromNodeId: args.from, toNodeId: args.to }] })));
  }

  if (cmd === 'fit') {
    const op = { type: 'fit_view' };
    if (args.ids) op.ids = String(args.ids).split(',').map((s) => s.trim()).filter(Boolean);
    if (args.padding) op.padding = Number(args.padding);
    if (args['max-zoom']) op.maxZoom = Number(args['max-zoom']);
    return out(summarize(await rpc('canvas_bridge_apply_ops', { ops: [op] })));
  }

  if (cmd === 'focus') {
    if (!args.node) throw new Error('focus needs --node');
    const op = { type: 'focus_node', id: args.node };
    if (args.zoom) op.zoom = Number(args.zoom);
    return out(summarize(await rpc('canvas_bridge_apply_ops', { ops: [op] })));
  }

  if (cmd === 'upload') {
    if (!args.node) throw new Error('upload needs --node');
    const op = { type: 'upload_asset', nodeId: args.node };
    if (args.url) op.url = args.url;
    if (args['data-url']) op.dataUrl = args['data-url'];
    if (args.mime) op.mimeType = args.mime;
    if (!op.url && !op.dataUrl) throw new Error('upload needs --url or --data-url');
    return out(summarize(await rpc('canvas_bridge_apply_ops', { ops: [op] })));
  }

  if (cmd === 'gen') {
    if (!args.node) throw new Error('gen needs --node');
    const op = { type: 'run_generation', nodeId: args.node };
    if (args.mode) op.mode = args.mode;
    if (args.prompt) op.prompt = args.prompt;
    await rpc('canvas_bridge_apply_ops', { ops: [op] });
    if (!args.wait) return out({ triggered: args.node, note: 'generation is async — poll `state` or pass --wait' });
    // Poll the node status until success/error or timeout. Interval >=15s per skill guidance.
    const deadline = Date.now() + (Number(args.timeout) || 180) * 1000;
    while (Date.now() < deadline) {
      await sleep(15000);
      const state = await rpc('canvas_bridge_get_state', {});
      const node = (state.nodes || []).find((n) => n.id === args.node);
      const status = node?.metadata?.status;
      if (status === 'success') return out({ node: args.node, status, content: node.metadata?.content, storageKey: node.metadata?.storageKey });
      if (status === 'error') return out({ node: args.node, status, error: node?.metadata?.errorDetails || 'generation failed' });
    }
    return out({ node: args.node, status: 'timeout', note: 'still loading after timeout; poll `state` later' });
  }

  if (cmd === 'shot') return out({ saved: await shotViaCdp(args.name) });

  throw new Error(`unknown command: ${cmd}\n${usage()}`);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exitCode = 1;
});
