/**
 * Product model surface for shared/embedded immersive chat.
 *
 * SeaChat / searouter `/v1/models/llm` is the live allowlist SSOT (listing_status,
 * availability). Product only owns preferred ordering + labels; extra online
 * models append after so users can pick anything the gateway has listed.
 * Catalog load failure keeps only the default (Flash).
 */
export interface ChatModelOption {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  /** Total input + output context window reported by the live model catalog. */
  readonly contextWindow?: number;
  /** True when this id is in the product preferred ranking (not a free-form catalog tail). */
  readonly preferred?: boolean;
}

/** Optional thinking grades. Always on for V4; no "off" product option. */
export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface ThinkingLevelOption {
  readonly id: ThinkingLevel;
  readonly label: string;
  readonly hint: string;
  /** OpenAI-compatible reasoning_effort sent to SeaChat. */
  readonly reasoningEffort: ThinkingLevel;
}

export const THINKING_LEVELS = [
  {
    id: 'low',
    label: 'Light',
    hint: 'Faster first token — good for casual chat',
    reasoningEffort: 'low',
  },
  {
    id: 'medium',
    label: 'Balanced',
    hint: 'Balance of speed and depth',
    reasoningEffort: 'medium',
  },
  {
    id: 'high',
    label: 'Deep',
    hint: 'Longer deliberation for complex turns',
    reasoningEffort: 'high',
  },
] as const satisfies readonly ThinkingLevelOption[];

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'low';

/**
 * Product preference ranking (not a hard allowlist gate).
 * When a preferred id is online in the live catalog it is listed first, in this
 * order. Catalog models outside this list append after for free choice.
 */
export const CHAT_MODEL_OPTIONS = [
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    model: 'deepseek-v4-pro',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    model: 'claude-sonnet-4-6',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    model: 'claude-opus-4-8',
  },
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    model: 'grok-4.5',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    model: 'gemini-3-flash-preview',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    model: 'gemini-3.1-pro-preview',
  },
] as const satisfies readonly ChatModelOption[];

/** @deprecated Prefer string model ids; catalog tail is open-ended. */
export type ChatModelOptionId = string;

export const DEFAULT_CHAT_MODEL: ChatModelOption = {
  ...CHAT_MODEL_OPTIONS[0],
  preferred: true,
};

export interface CatalogModel {
  readonly model: string;
  readonly state?: string;
  readonly recommended: boolean;
  readonly contextWindow?: number;
  readonly aliases: readonly string[];
  readonly listingStatus?: string;
  readonly isActive?: boolean;
  readonly capabilities: readonly string[];
  /** Display name when catalog provides one (optional). */
  readonly displayName?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = nonEmptyString(item);
    if (s) out.push(s);
  }
  return out;
}

function catalogItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];

  for (const key of ['models', 'data', 'items']) {
    if (record[key] !== undefined) return catalogItems(record[key]);
  }

  const llm = record.llm;
  if (llm !== undefined) return catalogItems(llm);
  return record.model !== undefined || record.id !== undefined ? [record] : [];
}

function catalogAvailability(record: UnknownRecord): {
  state?: string;
  recommended: boolean;
} {
  const availability = asRecord(record.availability);
  return {
    state: nonEmptyString(availability?.state) ?? nonEmptyString(record.state),
    recommended:
      typeof availability?.recommended === 'boolean'
        ? availability.recommended
        : record.recommended === true,
  };
}

function catalogMeta(record: UnknownRecord): Pick<
  CatalogModel,
  'aliases' | 'listingStatus' | 'isActive' | 'capabilities' | 'displayName'
> {
  const aliases = stringList(record.aliases);
  const capabilities = stringList(record.capabilities);
  const listingStatus =
    nonEmptyString(record.listing_status) ?? nonEmptyString(record.listingStatus);
  const isActive =
    typeof record.is_active === 'boolean'
      ? record.is_active
      : typeof record.isActive === 'boolean'
        ? record.isActive
        : undefined;
  const displayName =
    nonEmptyString(record.display_name) ??
    nonEmptyString(record.displayName) ??
    nonEmptyString(record.title) ??
    nonEmptyString(record.name);
  return {
    aliases,
    capabilities,
    ...(listingStatus ? { listingStatus } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...(displayName && displayName !== nonEmptyString(record.model)
      ? { displayName }
      : {}),
  };
}

function normalizeCatalogItem(item: unknown): CatalogModel[] {
  const record = asRecord(item);
  if (!record) return [];

  const model =
    nonEmptyString(record.model) ??
    nonEmptyString(record.id) ??
    nonEmptyString(record.name) ??
    nonEmptyString(record.slug);
  if (!model) return [];

  const parentContextWindow =
    positiveInteger(record.context_window) ?? positiveInteger(record.contextWindow);
  const meta = catalogMeta(record);

  if (Array.isArray(record.versions) && record.availability === undefined) {
    const versions = record.versions.flatMap((version) => {
      const versionRecord = asRecord(version);
      if (!versionRecord) return [];
      const contextWindow =
        positiveInteger(versionRecord.context_window) ??
        positiveInteger(versionRecord.contextWindow) ??
        parentContextWindow;
      const versionMeta = catalogMeta({ ...record, ...versionRecord });
      return [{
        model,
        ...catalogAvailability(versionRecord),
        ...versionMeta,
        ...(contextWindow ? { contextWindow } : {}),
      }];
    });
    if (versions.length > 0) return versions;
  }

  return [{
    model,
    ...catalogAvailability(record),
    ...meta,
    ...(parentContextWindow ? { contextWindow: parentContextWindow } : {}),
  }];
}

/** SeaChat catalog may list either hyphen or underscore model ids for the same upstream. */
function modelIdKeys(model: string): string[] {
  const hyphen = model.replaceAll('_', '-');
  const underscore = model.replaceAll('-', '_');
  return [...new Set([model, hyphen, underscore])];
}

function preferCatalogModel(previous: CatalogModel | undefined, next: CatalogModel): boolean {
  if (!previous) return true;
  if (!isCatalogHealthy(previous) && isCatalogHealthy(next)) return true;
  if (previous.contextWindow === undefined && next.contextWindow !== undefined) return true;
  if (previous.aliases.length === 0 && next.aliases.length > 0) return true;
  return false;
}

/** Normalize the permissive Platform SDK model catalog without leaking provider fields. */
export function normalizeChatModelCatalog(catalog: unknown): CatalogModel[] {
  const byModel = new Map<string, CatalogModel>();
  for (const model of catalogItems(catalog).flatMap(normalizeCatalogItem)) {
    if (preferCatalogModel(byModel.get(model.model), model)) {
      byModel.set(model.model, model);
    }
  }
  return [...byModel.values()];
}

function isCatalogHealthy(model: CatalogModel): boolean {
  // live_ok is the hard green light; unverified still routes for online listings.
  return model.state === 'live_ok' || model.state === 'unverified' || model.recommended;
}

function isCatalogHardFailed(model: CatalogModel): boolean {
  const state = model.state?.toLowerCase();
  return state === 'failed' || state === 'down' || state === 'disabled' || state === 'deprecated';
}

function isCatalogListed(model: CatalogModel): boolean {
  if (model.isActive === false) return false;
  const listing = model.listingStatus?.toLowerCase();
  if (listing && listing !== 'online' && listing !== 'listed' && listing !== 'active') {
    return false;
  }
  if (isCatalogHardFailed(model)) return false;
  // Prefer chat modality when capabilities are present; bare rows stay eligible.
  if (model.capabilities.length > 0 && !model.capabilities.includes('chat')) {
    return false;
  }
  return true;
}

function catalogMatchKeys(model: CatalogModel): string[] {
  const keys = new Set<string>();
  for (const id of [model.model, ...model.aliases]) {
    for (const key of modelIdKeys(id)) keys.add(key);
  }
  return [...keys];
}

function indexCatalogModels(models: readonly CatalogModel[]): Map<string, CatalogModel> {
  const byKey = new Map<string, CatalogModel>();
  for (const model of models) {
    for (const key of catalogMatchKeys(model)) {
      if (preferCatalogModel(byKey.get(key), model)) {
        byKey.set(key, model);
      }
    }
  }
  return byKey;
}

function lookupCatalogModel(
  byKey: Map<string, CatalogModel>,
  model: string,
): CatalogModel | undefined {
  for (const key of modelIdKeys(model)) {
    const hit = byKey.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/** Turn catalog ids like `claude_haiku_4_5_20251001` into readable labels. */
export function humanizeModelId(model: string): string {
  const cleaned = model
    .trim()
    .replaceAll('_', '-')
    .replace(/-+/g, '-');
  if (!cleaned) return model;
  return cleaned
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (/^v\d+/i.test(part)) return part.toUpperCase();
      // Short tokens (ai, 3d) — not "pro"/"max" (those title-case).
      if (part.length <= 2 && part === part.toLowerCase()) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function optionFromCatalog(
  catalogModel: CatalogModel,
  preferred?: ChatModelOption,
): ChatModelOption {
  if (preferred) {
    return {
      id: preferred.id,
      label: preferred.label,
      // Keep product wire id (aliases are accepted); stable for session prefs.
      model: preferred.model,
      preferred: true,
      ...(catalogModel.contextWindow
        ? { contextWindow: catalogModel.contextWindow }
        : {}),
    };
  }
  return {
    id: catalogModel.model,
    label: catalogModel.displayName ?? humanizeModelId(catalogModel.model),
    model: catalogModel.model,
    preferred: false,
    ...(catalogModel.contextWindow
      ? { contextWindow: catalogModel.contextWindow }
      : {}),
  };
}

/**
 * Live catalog is the allowlist SSOT. Preferred product ranking comes first when
 * still online; remaining listed chat models append (recommended first, then id).
 * Empty / unloadable catalog → only the default so the player still boots.
 */
export function availableChatModels(catalog: unknown): readonly ChatModelOption[] {
  const listed = normalizeChatModelCatalog(catalog).filter(isCatalogListed);
  if (listed.length === 0) {
    return [DEFAULT_CHAT_MODEL];
  }

  const byKey = indexCatalogModels(listed);
  const claimed = new Set<string>(); // catalog canonical model ids already placed
  const options: ChatModelOption[] = [];

  for (const preferred of CHAT_MODEL_OPTIONS) {
    const hit = lookupCatalogModel(byKey, preferred.model);
    if (!hit) continue;
    if (claimed.has(hit.model)) continue;
    claimed.add(hit.model);
    options.push(optionFromCatalog(hit, preferred));
  }

  const rest = listed
    .filter((model) => !claimed.has(model.model))
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      const aLive = a.state === 'live_ok' ? 0 : 1;
      const bLive = b.state === 'live_ok' ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return a.model.localeCompare(b.model);
    });

  for (const model of rest) {
    options.push(optionFromCatalog(model));
  }

  if (options.length === 0) return [DEFAULT_CHAT_MODEL];

  // Flash first when present among preferred hits; otherwise keep preferred+rest order.
  const flashIdx = options.findIndex((option) => option.id === DEFAULT_CHAT_MODEL.id);
  if (flashIdx > 0) {
    const flash = options[flashIdx]!;
    return [flash, ...options.slice(0, flashIdx), ...options.slice(flashIdx + 1)];
  }
  return options;
}

function optionMatchesId(option: ChatModelOption, optionId: string): boolean {
  const wanted = new Set(modelIdKeys(optionId));
  for (const key of [...modelIdKeys(option.id), ...modelIdKeys(option.model)]) {
    if (wanted.has(key)) return true;
  }
  return false;
}

/** Resolve persisted or user-provided option ids; unknown ids safely fall back to Flash. */
export function resolveChatModel(
  optionId: string | null | undefined,
  options: readonly ChatModelOption[] = CHAT_MODEL_OPTIONS,
): ChatModelOption {
  if (optionId) {
    const hit = options.find((option) => optionMatchesId(option, optionId));
    if (hit) return hit;
  }
  return (
    options.find((option) => option.id === DEFAULT_CHAT_MODEL.id) ??
    options[0] ??
    DEFAULT_CHAT_MODEL
  );
}

export function resolveThinkingLevel(
  value: string | null | undefined,
): ThinkingLevel {
  return THINKING_LEVELS.some((level) => level.id === value)
    ? (value as ThinkingLevel)
    : DEFAULT_THINKING_LEVEL;
}

export function thinkingLevelOption(level: ThinkingLevel): ThinkingLevelOption {
  return THINKING_LEVELS.find((item) => item.id === level) ?? THINKING_LEVELS[0];
}
