export interface CardDataLike {
  name?: unknown;
  description?: unknown;
  personality?: unknown;
  scenario?: unknown;
  first_mes?: unknown;
  tags?: unknown;
  creator?: unknown;
  character_version?: unknown;
  extensions?: unknown;
}

export interface CardPresentation {
  name: string;
  description: string;
  subtitle: string;
  inputPlaceholder: string;
  coverUrl: string | null;
  accent: string;
  coverPosition: string;
  tags: string[];
}

/** Options when resolving presentation in a shared player (cross-origin card host). */
export interface DeriveCardPresentationOptions {
  /**
   * Origin that hosts catalog + project assets for this card
   * (e.g. https://leo-deoraphly.play.seachat.ai from ?cardHost=).
   */
  cardHost?: string | null;
  /** URL search string; defaults to window.location.search when available. */
  search?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstLine(value: unknown): string {
  return text(value).split(/\n+/)[0]?.trim() ?? '';
}

function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const t = host.trim().replace(/\/$/, '');
  if (!t) return null;
  try {
    // Accept bare origin or full URL
    if (t.startsWith('http://') || t.startsWith('https://')) {
      return new URL(t).origin;
    }
    return new URL(`https://${t}`).origin;
  } catch {
    return null;
  }
}

/** Read cardHost from launch query (?cardHost=). */
export function cardHostFromSearch(search?: string): string | null {
  const raw =
    search ??
    (typeof window !== 'undefined' ? window.location.search : '');
  const value = new URLSearchParams(raw).get('cardHost');
  return normalizeHost(value);
}

/**
 * Convert seashort.cover into a browser-loadable URL.
 * Supports:
 * - { kind: 'url', url: 'https://…' }
 * - { kind: 'project_asset', path: 'public/assets/…' } → /assets/… (+ optional cardHost)
 * - plain https string (legacy)
 */
export function resolveCoverUrl(
  value: unknown,
  options?: { cardHost?: string | null },
): string | null {
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('https://') || s.startsWith('http://')) return s;
    if (s.startsWith('/')) {
      const host = normalizeHost(options?.cardHost);
      return host ? `${host}${s}` : s;
    }
    return null;
  }

  const asset = record(value);
  if (!asset) return null;

  const kind = text(asset.kind);

  if (kind === 'url' || kind === 'http' || kind === 'https') {
    const url = text(asset.url) || text(asset.href) || text(asset.src);
    if (url.startsWith('https://') || url.startsWith('http://')) return url;
    if (url.startsWith('/')) {
      const host = normalizeHost(options?.cardHost);
      return host ? `${host}${url}` : url;
    }
    return null;
  }

  if (kind === 'project_asset' || kind === '') {
    return projectAssetUrl(asset, options?.cardHost);
  }

  return null;
}

/** Convert the persisted project-relative cover path into a public URL. */
export function projectAssetUrl(
  value: unknown,
  cardHost?: string | null,
): string | null {
  const asset = record(value);
  if (!asset) return null;
  // Allow callers that already gated kind, or bare { path }.
  const kind = text(asset.kind);
  if (kind && kind !== 'project_asset') return null;

  const path = text(asset.path).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path.startsWith('public/assets/') || path.includes('/../') || path.endsWith('/..')) {
    return null;
  }

  // Vite / slim host: public/assets/x → /assets/x
  const publicPath = path.slice('public'.length);
  const encoded = encodeURI(publicPath).replaceAll('#', '%23').replaceAll('?', '%3F');
  const host = normalizeHost(cardHost);
  return host ? `${host}${encoded}` : encoded;
}

/** Brand champagne — the default accent before any card colour resolves. */
export const DEFAULT_ACCENT = '#e0b888';

/** Readability window for cover-derived accents (aligned with play entry-accent). */
export const ACCENT_SATURATION = { min: 35, max: 70 } as const;
export const ACCENT_LIGHTNESS = { min: 55, max: 70 } as const;

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Parse `#rgb` / `#rrggbb` into an 8-bit RGB triple; null when unparseable. */
function parseHex(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(hex[0]! + hex[0]!, 16);
    const g = Number.parseInt(hex[1]! + hex[1]!, 16);
    const b = Number.parseInt(hex[2]! + hex[2]!, 16);
    return { r, g, b };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = ((gn - bn) / delta) % 6;
        break;
      case gn:
        h = (bn - rn) / delta + 2;
        break;
      default:
        h = (rn - gn) / delta + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  const to255 = (v: number): string =>
    clampNumber(Math.round((v + m) * 255), 0, 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/**
 * Pull a hex colour into the readable accent window: keep hue, clamp saturation
 * to [35–70]% and lightness to [55–70]% so it reads against the near-black base
 * and never blows out. Returns a `#rrggbb` string, or null when unparseable.
 */
export function clampAccentHex(value: unknown): string | null {
  const raw = text(value);
  const rgb = parseHex(raw);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const sat = clampNumber(Math.round(s), ACCENT_SATURATION.min, ACCENT_SATURATION.max);
  const light = clampNumber(Math.round(l), ACCENT_LIGHTNESS.min, ACCENT_LIGHTNESS.max);
  return hslToHex(h, sat, light);
}

/**
 * Resolve the stage accent (spec: zero-config character theming).
 * Priority: presentation.accent (explicit, verbatim) → clamped
 * import_source.img_primary_color (cover-derived, pulled into readable band)
 * → champagne default.
 */
export function resolveAccent(
  presentationAccent: unknown,
  importPrimaryColor: unknown,
): string {
  const explicit = text(presentationAccent);
  if (/^#[0-9a-fA-F]{6}$/.test(explicit)) return explicit;
  const derived = clampAccentHex(importPrimaryColor);
  if (derived) return derived;
  return DEFAULT_ACCENT;
}

function safeCoverPosition(value: unknown): string {
  const candidate = text(value);
  const match = candidate.match(/^(\d{1,3})%\s+(\d{1,3})%$/);
  if (!match) return '50% 35%';
  const x = Math.min(100, Number(match[1]));
  const y = Math.min(100, Number(match[2]));
  return `${x}% ${y}%`;
}

export function deriveCardPresentation(
  data: CardDataLike,
  options: DeriveCardPresentationOptions = {},
): CardPresentation {
  const extensions = record(data.extensions);
  const seashort = record(extensions?.seashort);
  const presentation = record(seashort?.presentation);
  const importSource = record(seashort?.import_source);
  const name = text(data.name) || 'Character';
  const scenario = firstLine(data.scenario);
  const personality = firstLine(data.personality);
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 4)
    : [];

  const cardHost =
    normalizeHost(options.cardHost) ?? cardHostFromSearch(options.search);

  return {
    name,
    description: text(data.description),
    subtitle: text(presentation?.subtitle) || scenario || personality,
    inputPlaceholder: text(presentation?.input_placeholder) || `Message ${name}...`,
    coverUrl: (resolveCoverUrl(seashort?.animated, { cardHost }) ?? resolveCoverUrl(seashort?.cover, { cardHost })),
    accent: resolveAccent(presentation?.accent, importSource?.img_primary_color),
    coverPosition: safeCoverPosition(presentation?.cover_position),
    tags,
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Interim stable identity until project UUID is part of the scaffold contract. */
export function cardIdentity(data: CardDataLike): string {
  const extensions = record(data.extensions);
  const seashort = record(extensions?.seashort);
  const explicitId = text(seashort?.card_id);
  const source = explicitId
    ? `id:${explicitId}`
    : [
        text(data.name),
        text(data.creator),
        text(data.character_version),
        text(data.description),
        text(data.first_mes),
      ].join('\u001f');
  return `role-chat-${fnv1a(source)}`;
}
