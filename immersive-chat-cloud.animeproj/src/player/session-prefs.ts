/**
 * Player-facing session settings (Tipsy-style): model, thinking, memory, persona, pinned.
 * Stored in session metadata; applied as engine overrides — never writes card.json.
 *
 * Account-level default persona lives on SeaChat (`client.playerPersona` / user_kv).
 * Session metadata overrides that default for the current chat.
 */
import type { RoleWorldSessionDocument, SeaChat } from '@seachat/sdk';
import {
  buildUserPersonaText,
  hasPlayerPersonaContent,
  normalizePlayerPersona,
  playerPersonaToEngine,
  type PlayerPersona,
  type PlayerPersonaGender,
} from '@seachat/sdk';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_THINKING_LEVEL,
  resolveChatModel,
  resolveThinkingLevel,
  type ChatModelOption,
  type ThinkingLevel,
} from './models.ts';

export type { PlayerPersona, PlayerPersonaGender };
/** @deprecated use PlayerPersonaGender */
export type PersonaGender = PlayerPersonaGender;

/** Discrete memory depths (tokens). DeepSeek V4 supports up to 1M. */
export const MEMORY_LIMITS = [
  4_000,
  8_000,
  16_000,
  32_000,
  64_000,
  128_000,
  256_000,
  512_000,
  1_000_000,
] as const;

export type MemoryLimit = (typeof MEMORY_LIMITS)[number];

export const DEFAULT_MEMORY_LIMIT: MemoryLimit = 32_000;
export const PINNED_MEMORY_MAX_CHARS = 2000;

/** Product default when no account persona and no session override. */
export const DEFAULT_PERSONA: PlayerPersona = {
  name: 'You',
  bio: '',
  gender: '',
};

export {
  buildUserPersonaText,
  hasPlayerPersonaContent,
  playerPersonaToEngine,
};

/** Session metadata shape (flat for storage compatibility). */
export interface SessionPrefs {
  model: string;
  thinking: string;
  memoryLimit: number;
  personaName: string;
  personaBio: string;
  personaGender: string;
  pinnedMemory: string;
}

export interface PlayerSettings {
  model: ChatModelOption;
  thinking: ThinkingLevel;
  memoryLimit: MemoryLimit;
  persona: PlayerPersona;
  pinnedMemory: string;
}

export function defaultPlayerSettings(
  model: ChatModelOption = DEFAULT_CHAT_MODEL,
): PlayerSettings {
  return {
    model,
    thinking: DEFAULT_THINKING_LEVEL,
    memoryLimit: DEFAULT_MEMORY_LIMIT,
    persona: { ...DEFAULT_PERSONA },
    pinnedMemory: '',
  };
}

export function prefsFromSettings(settings: PlayerSettings): SessionPrefs {
  return {
    model: settings.model.id,
    thinking: settings.thinking,
    memoryLimit: settings.memoryLimit,
    personaName: settings.persona.name,
    personaBio: settings.persona.bio,
    personaGender: settings.persona.gender,
    pinnedMemory: settings.pinnedMemory,
  };
}

export function resolveMemoryLimit(value: unknown): MemoryLimit {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MEMORY_LIMIT;
  // Snap to nearest allowed tier (prefer exact match).
  let best: MemoryLimit = DEFAULT_MEMORY_LIMIT;
  let bestDist = Infinity;
  for (const tier of MEMORY_LIMITS) {
    const d = Math.abs(tier - n);
    if (d < bestDist) {
      best = tier;
      bestDist = d;
    }
  }
  return best;
}

export function formatMemoryLabel(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(tokens);
}

/** Rough in-context usage from chat text (chars/2 ≈ tokens for mixed CJK). */
export function estimateContextUsageTokens(
  messages: readonly { content?: string }[],
): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
  }
  return Math.max(0, Math.round(chars / 2));
}

export function clampPinnedMemory(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= PINNED_MEMORY_MAX_CHARS) return text;
  return chars.slice(0, PINNED_MEMORY_MAX_CHARS).join('');
}

export function normalizePersona(input: Partial<PlayerPersona> | null | undefined): PlayerPersona {
  return normalizePlayerPersona(input, DEFAULT_PERSONA.name);
}

function metaString(metadata: RoleWorldSessionDocument['metadata'], key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function metaNumber(metadata: RoleWorldSessionDocument['metadata'], key: string): number | null {
  const value = metadata?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Read persona from session metadata without applying account defaults. */
export function readSessionPersona(
  metadata: RoleWorldSessionDocument['metadata'] | undefined,
): PlayerPersona {
  return normalizePersona({
    name: metaString(metadata, 'personaName') ?? DEFAULT_PERSONA.name,
    bio: metaString(metadata, 'personaBio') ?? '',
    gender: (metaString(metadata, 'personaGender') ?? '') as PlayerPersonaGender,
  });
}

/** Whether session metadata already carries a non-default persona. */
export function sessionHasPersona(
  metadata: RoleWorldSessionDocument['metadata'] | undefined,
): boolean {
  return hasPlayerPersonaContent(readSessionPersona(metadata), DEFAULT_PERSONA.name);
}

export function readPlayerSettings(
  document: RoleWorldSessionDocument,
  modelOptions?: readonly ChatModelOption[],
): PlayerSettings {
  const meta = document.metadata;
  return {
    model: resolveChatModel(metaString(meta, 'model'), modelOptions),
    thinking: resolveThinkingLevel(metaString(meta, 'thinking')),
    memoryLimit: resolveMemoryLimit(metaNumber(meta, 'memoryLimit') ?? DEFAULT_MEMORY_LIMIT),
    persona: readSessionPersona(meta),
    pinnedMemory: clampPinnedMemory(metaString(meta, 'pinnedMemory') ?? ''),
  };
}

/**
 * Resolve persona: session override → account default (kv) → product default.
 * When seeding from account, caller should persist back into session metadata.
 */
export async function resolvePersonaForSession(
  client: SeaChat | null | undefined,
  metadata: RoleWorldSessionDocument['metadata'] | undefined,
): Promise<{ persona: PlayerPersona; seededFromAccount: boolean }> {
  if (sessionHasPersona(metadata)) {
    return { persona: readSessionPersona(metadata), seededFromAccount: false };
  }
  if (client) {
    try {
      const remote = await client.playerPersona.get();
      if (remote && hasPlayerPersonaContent(remote, DEFAULT_PERSONA.name)) {
        return {
          persona: normalizePersona(remote),
          seededFromAccount: true,
        };
      }
    } catch {
      /* offline / scope — fall through */
    }
  }
  return { persona: { ...DEFAULT_PERSONA }, seededFromAccount: false };
}

/** Dual-write: session prefs already saved by caller; also upsert account default. */
export async function syncPersonaToAccount(
  client: SeaChat | null | undefined,
  persona: PlayerPersona,
): Promise<void> {
  if (!client) return;
  try {
    await client.playerPersona.set(normalizePersona(persona));
  } catch {
    /* best-effort — session still holds the value */
  }
}

/**
 * WorldEngine expands `{{user}}` into history at write time. `configure({ userName })`
 * only affects future macros — rewrite stored message text so the model stops
 * echoing the previous name.
 */
export function rewriteUserNameInText(
  text: string,
  oldName: string,
  newName: string,
): string {
  if (!oldName || oldName === newName || !text.includes(oldName)) return text;
  return text.split(oldName).join(newName);
}

export function rewriteUserNameInMessages<
  T extends { role: string; name?: string; content: string },
>(messages: readonly T[], oldName: string, newName: string): T[] {
  if (!oldName || oldName === newName) {
    return messages.map((message) => ({ ...message }));
  }
  return messages.map((message) => ({
    ...message,
    content: rewriteUserNameInText(message.content, oldName, newName),
    name: message.name === oldName ? newName : message.name,
  }));
}

/** @deprecated use readPlayerSettings — kept for existing tests */
export function readSessionModel(document: RoleWorldSessionDocument): string | null {
  return metaString(document.metadata, 'model');
}

/** @deprecated use readPlayerSettings */
export function readSessionThinking(document: RoleWorldSessionDocument): string | null {
  return metaString(document.metadata, 'thinking');
}
