/**
 * Message display pipeline for immersive-chat:
 *  1. strip model control tags (think / 正文) — streaming + legacy polluted history
 *  2. ST display regex (markdownOnly / AI_OUTPUT with isMarkdown:true)
 *  3. novel + light-markdown formatting → safe HTML
 *  4. sanitize
 *
 * Engine handleTextTurn already runs extractZhengwen on finalize; this layer is
 * defense-in-depth for live tokens and old sessions that stored raw tags.
 */
import {
  renderAiOutput,
  type RegexScript,
} from '@seachat/sdk/render/render';
import { DEFAULT_BOUND } from './card.ts';
import {
  escapeHtml,
  formatNovelHtml,
  polishExistingHtml,
  sanitizeDisplayHtml,
} from './message-format.ts';

export interface FormatMessageOptions {
  regexScripts?: readonly RegexScript[] | null;
  role?: 'user' | 'assistant' | 'system';
}

export interface StatusPanelFields {
  current: string;
  character: string;
  plot: string;
}

const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const THINK_TAG_RE = /<\/?think\b[^>]*>/gi;
const ZHENGWEN_PAIR_RE = /<正文>([\s\S]*?)<\/正文>/;
const ZHENGWEN_OPEN = '<正文>';
const ZHENGWEN_CLOSE = '</正文>';
const MAINTEXT_PAIR_RE = /<maintext\b[^>]*>([\s\S]*?)<\/maintext>/i;
/** Status protocol labels — English product default; Chinese kept for legacy cards. */
const STATUS_LABEL_CURRENT = '(?:Current Status|当前状态)';
const STATUS_LABEL_CHARACTER = '(?:Character Status|角色状态)';
const STATUS_LABEL_PLOT = '(?:Plot Progress|剧情发展)';
const STATUS_BLOCK_RE = new RegExp(
  `<Status_block\\b[^>]*>\\s*${STATUS_LABEL_CURRENT}[：:]\\s*([\\s\\S]*?)\\s*${STATUS_LABEL_CHARACTER}[：:]\\s*([\\s\\S]*?)\\s*${STATUS_LABEL_PLOT}[：:]\\s*([\\s\\S]*?)\\s*<\\/Status_block>`,
  'i',
);
/** Fallback when display regex already turned Status_block into **labels**. */
const STATUS_MARKDOWN_RE = new RegExp(
  `\\n{0,2}\\*\\*${STATUS_LABEL_CURRENT}\\*\\*[：:]\\s*([^\\n*]+)\\s*\\n\\*\\*${STATUS_LABEL_CHARACTER}\\*\\*[：:]\\s*([^\\n*]+)\\s*\\n\\*\\*${STATUS_LABEL_PLOT}\\*\\*[：:]\\s*([^\\n*]+)\\s*$`,
  'i',
);
const STATUS_PANEL_KEYS = {
  current: 'Current Status',
  character: 'Character Status',
  plot: 'Plot Progress',
} as const;
const AI_OUTPUT_PLACEMENT = 2;

/**
 * Strip reasoning/body control tags from model output for display.
 * Mirrors world-engine extractZhengwen semantics so streaming and history match.
 */
export function stripModelControlTags(text: string): string {
  if (!text) return '';
  let out = text.replace(THINK_BLOCK_RE, '').replace(THINK_TAG_RE, '');

  const pair = out.match(ZHENGWEN_PAIR_RE);
  if (pair) {
    // Prefer first closed body; drop status-bar / pre-amble outside the pair.
    out = pair[1] ?? '';
  } else {
    const openIdx = out.indexOf(ZHENGWEN_OPEN);
    if (openIdx >= 0) {
      out = out.slice(openIdx + ZHENGWEN_OPEN.length).replace(/<\/正文>\s*$/, '');
    } else {
      // Bare tags without a body region (e.g. only </正文>)
      out = out.replace(/<\/?正文>/g, '');
    }
  }

  return out.trim();
}

export interface DisplayReasoningSplit {
  reasoning: string;
  body: string;
}

/** Split reasoning/body for transient UI only; Actor owns finalization and storage. */
export function splitReasoningForDisplay(raw: string): DisplayReasoningSplit {
  if (!raw) return { reasoning: '', body: '' };
  const cleaned = raw.replace(THINK_BLOCK_RE, '').replace(THINK_TAG_RE, '');
  const hasMarker = cleaned.includes(ZHENGWEN_OPEN) || cleaned.includes(ZHENGWEN_CLOSE);
  if (!hasMarker) return { reasoning: cleaned.trim(), body: '' };

  const pair = cleaned.match(ZHENGWEN_PAIR_RE);
  if (pair && pair.index !== undefined) {
    const before = cleaned.slice(0, pair.index).trim();
    const after = cleaned.slice(pair.index + pair[0].length).trim();
    return {
      reasoning: [before, after].filter(Boolean).join('\n').trim(),
      body: (pair[1] ?? '').trim(),
    };
  }

  const open = cleaned.indexOf(ZHENGWEN_OPEN);
  if (open >= 0) {
    return {
      reasoning: cleaned.slice(0, open).trim(),
      body: cleaned.slice(open + ZHENGWEN_OPEN.length).replace(/<\/正文>\s*$/, '').trim(),
    };
  }
  return { reasoning: cleaned.replace(/<\/正文>/g, '').trim(), body: '' };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Map loose ST/ccv3 regex script shapes into world-engine RegexScript. */
export function normalizeRegexScript(raw: unknown, index: number): RegexScript | null {
  const r = asRecord(raw);
  if (!r) return null;
  const findRegex = typeof r.findRegex === 'string' ? r.findRegex : '';
  if (!findRegex) return null;
  const placement = Array.isArray(r.placement)
    ? r.placement.filter((p): p is number => typeof p === 'number')
    : [];
  if (placement.length === 0) return null;
  const id =
    typeof r.id === 'string' && r.id
      ? r.id
      : typeof r.scriptName === 'string' && r.scriptName
        ? r.scriptName
        : `regex-${index}`;
  return {
    id,
    scriptName: typeof r.scriptName === 'string' && r.scriptName ? r.scriptName : id,
    findRegex,
    replaceString: typeof r.replaceString === 'string' ? r.replaceString : '',
    trimStrings: Array.isArray(r.trimStrings)
      ? r.trimStrings.filter((s): s is string => typeof s === 'string')
      : undefined,
    placement,
    disabled: r.disabled === true,
    markdownOnly: r.markdownOnly === true,
    promptOnly: r.promptOnly === true,
    substituteRegex: typeof r.substituteRegex === 'number' ? r.substituteRegex : undefined,
    minDepth: typeof r.minDepth === 'number' ? r.minDepth : undefined,
    maxDepth: typeof r.maxDepth === 'number' ? r.maxDepth : undefined,
    runOnEdit: typeof r.runOnEdit === 'boolean' ? r.runOnEdit : undefined,
  };
}

/**
 * Collect display-capable regex scripts from:
 *  - runtime CharacterCard.regexScripts (ccv3 top-level extensions.regex_scripts)
 *  - imported ST presets that bury scripts under oai_preset.extensions.regex_scripts
 */
export function collectDisplayRegexScripts(
  cardScripts: readonly RegexScript[] | undefined = DEFAULT_BOUND.card.regexScripts,
  envelope: unknown = DEFAULT_BOUND.envelope,
): RegexScript[] {
  const out: RegexScript[] = [];
  const seen = new Set<string>();

  const pushAll = (list: unknown) => {
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      const script = normalizeRegexScript(item, index);
      if (!script || script.disabled) return;
      // Display path: markdownOnly scripts, or "neither" scripts that also list AI_OUTPUT.
      // Pure promptOnly (without markdownOnly) stays off the screen.
      const displayCapable =
        script.markdownOnly === true
        || (!script.markdownOnly && !script.promptOnly);
      if (!displayCapable) return;
      if (!script.placement.includes(AI_OUTPUT_PLACEMENT)) return;
      const key = `${script.id}|${script.findRegex}|${script.replaceString}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(script);
    });
  };

  pushAll(cardScripts);

  const root = asRecord(envelope);
  const data = asRecord(root?.data) ?? root;
  const ext = asRecord(data?.extensions);
  pushAll(ext?.regex_scripts);
  const oai = asRecord(ext?.oai_preset);
  const oaiExt = asRecord(oai?.extensions);
  pushAll(oaiExt?.regex_scripts);

  return out;
}

/** Run ST display-path regex (isMarkdown: true, AI_OUTPUT placement). */
export function applyDisplayRegex(
  text: string,
  scripts: readonly RegexScript[],
): string {
  if (!text || scripts.length === 0) return text;
  return renderAiOutput(text, [...scripts]);
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-zA-Z][^>]*>/.test(text);
}

/**
 * Pull Leo/Tipsy-style protocol envelope out of assistant text so narrative can
 * stay on the novel path while Status_block becomes a visible status panel.
 */
export function extractStatusPanel(text: string): {
  body: string;
  status: StatusPanelFields | null;
} {
  if (!text) return { body: '', status: null };

  let body = text;
  let status: StatusPanelFields | null = null;

  const block = body.match(STATUS_BLOCK_RE);
  if (block) {
    status = {
      current: (block[1] ?? '').trim(),
      character: (block[2] ?? '').trim(),
      plot: (block[3] ?? '').trim(),
    };
    body = body.replace(STATUS_BLOCK_RE, '');
  }

  const main = body.match(MAINTEXT_PAIR_RE);
  if (main) {
    body = (main[1] ?? '').trim();
  } else {
    body = body.replace(/<\/?maintext\b[^>]*>/gi, '').trim();
  }

  // Residual protocol tags (malformed / partial streams)
  body = body
    .replace(/<\/?Status_block\b[^>]*>/gi, '')
    .replace(/<\/?user_action\b[^>]*>/gi, '')
    .trim();

  if (!status) {
    const md = body.match(STATUS_MARKDOWN_RE);
    if (md) {
      status = {
        current: (md[1] ?? '').trim(),
        character: (md[2] ?? '').trim(),
        plot: (md[3] ?? '').trim(),
      };
      body = body.replace(STATUS_MARKDOWN_RE, '').trim();
    }
  }

  return { body, status };
}

/** Visible status panel — only sanitize-allowlisted tags (span/strong). */
export function renderStatusPanelHtml(status: StatusPanelFields): string {
  const row = (key: string, value: string) =>
    `<span class="status-row">`
    + `<strong class="status-key">${escapeHtml(key)}</strong>`
    + `<span class="status-val">：${escapeHtml(value)}</span>`
    + `</span>`;

  // Allowlist only permits optional class= on span/strong — no role/data attrs.
  return sanitizeDisplayHtml(
    `<span class="status-panel">`
    + row(STATUS_PANEL_KEYS.current, status.current)
    + row(STATUS_PANEL_KEYS.character, status.character)
    + row(STATUS_PANEL_KEYS.plot, status.plot)
    + `</span>`,
  );
}

/**
 * Full display pipeline. Returns sanitized HTML safe for dangerouslySetInnerHTML.
 *
 * @param raw message text
 * @param options.regexScripts when null/undefined, uses card-collected scripts;
 *   pass [] to skip display regex (tests for pure novel formatting).
 */
export function formatMessageHtml(
  raw: string,
  options: FormatMessageOptions = {},
): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';

  const scripts =
    options.regexScripts === null
      ? []
      : options.regexScripts !== undefined
        ? options.regexScripts
        : collectDisplayRegexScripts();

  const stripped = stripModelControlTags(raw);
  // Protocol envelope first — keeps Status_block off the novel path as a real panel.
  const { body, status } = extractStatusPanel(stripped);
  const afterRegex = applyDisplayRegex(body, scripts);

  // Only take the "regex emitted HTML" path when scripts actually changed the string
  // and the result contains tags. User-typed angle brackets still go through novel format
  // (which escapes them) so *action* / quotes still style correctly.
  let narrativeHtml: string;
  if (afterRegex !== body && looksLikeHtml(afterRegex)) {
    narrativeHtml = polishExistingHtml(afterRegex);
  } else {
    narrativeHtml = formatNovelHtml(afterRegex);
  }

  if (!status) return narrativeHtml;
  return `${narrativeHtml}${renderStatusPanelHtml(status)}`;
}

export function formatBubbleHtml(
  raw: string,
  role: 'user' | 'assistant' | 'system' = 'assistant',
  scripts?: readonly RegexScript[] | null,
): string {
  return formatMessageHtml(raw, { role, regexScripts: scripts });
}

export { sanitizeDisplayHtml } from './message-format.ts';
