/**
 * Hard acceptance orchestrator — cloud worldcompute only.
 *
 * Gates: unit/tsc/build + monorepo Rust parity + production HTTP/SSE + browser UI.
 * No local world_compute_actor process.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, installLocalNoProxy } from './accept-env.ts';

installLocalNoProxy();

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJ = join(__dir, '..');
const REPO = join(PROJ, '../..');
const OUT = join(PROJ, '.accept');
mkdirSync(OUT, { recursive: true });

type Gate = {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  /** Skip when SEACHAT_PROD_EMAIL_LOGIN_* missing (local CI without secrets). */
  needsCloudCreds?: boolean;
};

type GateResult = {
  name: string;
  command: string;
  ok: boolean;
  skipped?: boolean;
  status: number | null;
  durationMs: number;
  log: string;
};

const gates: Gate[] = [
  { name: 'project tests', command: 'bun', args: ['run', 'test'], cwd: PROJ },
  { name: 'typecheck', command: 'bunx', args: ['tsc', '--noEmit'], cwd: PROJ },
  { name: 'production build', command: 'bun', args: ['run', 'build'], cwd: PROJ },
  {
    name: 'rust world-compute unit+parity',
    command: 'make',
    args: ['test-world-compute'],
    cwd: REPO,
  },
  {
    name: 'cloud live HTTP/SSE',
    command: 'bun',
    args: ['run', 'accept:cloud-live'],
    cwd: PROJ,
    needsCloudCreds: true,
  },
  {
    name: 'cloud UI Actor path',
    command: 'bun',
    args: ['run', 'accept:cloud-ui'],
    cwd: PROJ,
    needsCloudCreds: true,
  },
];

function hasCloudCreds(): boolean {
  return Boolean(
    process.env.SEACHAT_PROD_EMAIL_LOGIN_URL?.trim()
    && process.env.SEACHAT_PROD_EMAIL_LOGIN_EMAIL?.trim()
    && process.env.SEACHAT_PROD_EMAIL_LOGIN_PASSWORD?.trim(),
  );
}

function runGate(gate: Gate): GateResult {
  if (gate.needsCloudCreds && !hasCloudCreds()) {
    const gateResult: GateResult = {
      name: gate.name,
      command: [gate.command, ...gate.args].join(' '),
      ok: true,
      skipped: true,
      status: null,
      durationMs: 0,
      log: 'skipped: set SEACHAT_PROD_EMAIL_LOGIN_{URL,EMAIL,PASSWORD} for cloud gates',
    };
    console.log(`\n## SKIP ${gate.name} (no cloud login env)`);
    return gateResult;
  }
  const started = performance.now();
  const result = spawnSync(gate.command, gate.args, {
    cwd: gate.cwd ?? PROJ,
    encoding: 'utf8',
    env: childEnv({}),
    maxBuffer: 64 * 1024 * 1024,
  });
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const status = result.status;
  const gateResult: GateResult = {
    name: gate.name,
    command: [gate.command, ...gate.args].join(' '),
    ok: status === 0,
    status,
    durationMs: Math.round(performance.now() - started),
    log,
  };
  writeFileSync(
    join(OUT, `hard-${gate.name.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()}.log`),
    log,
  );
  const tail = log.trim().split('\n').slice(-14).join('\n');
  console.log(`\n## ${gateResult.ok ? 'PASS' : 'FAIL'} ${gate.name} (${gateResult.durationMs}ms, exit=${status})`);
  if (tail) console.log(tail);
  return gateResult;
}

const results = gates.map(runGate);
const ok = results.every((result) => result.ok);
const report = {
  verdict: ok ? 'ACCEPT' : 'REJECT',
  worldcompute: 'https://seachat.ai/api/worldcompute',
  counts: {
    passed: results.filter((result) => result.ok && !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    total: results.length,
  },
  note:
    'Live Actor is production seagate/worldcompute only. '
    + 'make test-world-compute owns assemble/WI goldens; '
    + 'accept:cloud-live / accept:cloud-ui own real model SSE and UI.',
  results: results.map(({ log: _log, ...result }) => result),
};
writeFileSync(join(OUT, 'hard-accept.json'), JSON.stringify(report, null, 2));
console.log(
  `\n# VERDICT: ${report.verdict} `
  + `(${results.filter((r) => r.ok).length}/${results.length} gates ok, `
  + `${report.counts.skipped} skipped)`,
);
process.exit(ok ? 0 : 1);
