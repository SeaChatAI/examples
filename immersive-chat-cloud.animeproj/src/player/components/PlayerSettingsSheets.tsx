import { useEffect, useMemo, useState } from 'react';
import {
  CHAT_MODEL_OPTIONS,
  THINKING_LEVELS,
  type ChatModelOption,
  type ThinkingLevel,
} from '../models.ts';
import {
  DEFAULT_MEMORY_LIMIT,
  MEMORY_LIMITS,
  PINNED_MEMORY_MAX_CHARS,
  clampPinnedMemory,
  formatMemoryLabel,
  normalizePersona,
  type MemoryLimit,
  type PersonaGender,
  type PlayerPersona,
  type PlayerSettings,
} from '../session-prefs.ts';

type SheetId = 'memory-model' | 'persona' | 'pinned' | null;

const GENDER_OPTIONS: { id: PersonaGender; label: string }[] = [
  { id: '', label: 'Not set' },
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'nonbinary', label: 'Non-binary' },
  { id: 'other', label: 'Other' },
];

function memoryIndex(limit: number): number {
  const idx = MEMORY_LIMITS.indexOf(limit as MemoryLimit);
  if (idx >= 0) return idx;
  let best = 0;
  let bestDist = Infinity;
  MEMORY_LIMITS.forEach((tier, i) => {
    const d = Math.abs(tier - limit);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

function ModelCard({
  option,
  selected,
  onSelect,
  blurb,
}: {
  option: ChatModelOption;
  selected: boolean;
  onSelect: () => void;
  blurb: string;
}) {
  return (
    <button
      type="button"
      className={`settings-model-card ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="settings-model-card-head">
        <span className="settings-model-card-title">{option.label}</span>
        {selected && <span className="settings-model-card-check" aria-hidden="true">✓</span>}
      </div>
      <p className="settings-model-card-blurb">{blurb}</p>
    </button>
  );
}

const MODEL_BLURBS: Record<string, string> = {
  'deepseek-v4-flash': 'Faster first token; good for casual chat and snappy turns.',
  'deepseek-v4-pro': 'Deeper narrative and reasoning; good for complex plots and long arcs.',
  'claude-sonnet-4-6': 'Balanced writing and roleplay for most immersive chats.',
  'claude-opus-4-8': 'Strongest narrative consistency; for long arcs and hard scenes.',
  'grok-4.5': 'Fast and distinctive; good for light chat and quick back-and-forth.',
  'gemini-3-flash-preview': 'Light, fast Gemini 3 for quick multi-turn chat.',
  'gemini-3.1-pro-preview': 'Stronger reasoning and long context for complex setups.',
};

export function SettingsChips({
  settings,
  usageTokens,
  disabled,
  onOpen,
}: {
  settings: PlayerSettings;
  usageTokens: number;
  disabled?: boolean;
  onOpen: (id: Exclude<SheetId, null>) => void;
}) {
  const thinkLabel =
    THINKING_LEVELS.find((t) => t.id === settings.thinking)?.label ?? settings.thinking;
  const modelShort = settings.model.label.replace(/^DeepSeek V4 /i, '');
  const personaLabel = settings.persona.name.trim() || 'You';
  const pinnedOn = settings.pinnedMemory.trim().length > 0;

  return (
    <div className="settings-chips" role="toolbar" aria-label="Chat settings">
      <button
        type="button"
        className="settings-chip"
        disabled={disabled}
        onClick={() => onOpen('memory-model')}
        title={`Model · ${modelShort} · ${thinkLabel}`}
        aria-label={`Model and memory: ${modelShort}, thinking ${thinkLabel}`}
      >
        <span className="settings-chip-icon" aria-hidden="true">
          ◆
        </span>
        <span className="settings-chip-main">{modelShort}</span>
      </button>
      <button
        type="button"
        className="settings-chip"
        disabled={disabled}
        onClick={() => onOpen('persona')}
        title={`Who I am · ${personaLabel}`}
        aria-label={`Who I am: ${personaLabel}`}
      >
        <span className="settings-chip-icon" aria-hidden="true">
          ◎
        </span>
        <span className="settings-chip-main">{personaLabel}</span>
      </button>
      <button
        type="button"
        className={`settings-chip ${pinnedOn ? 'is-active' : ''}`}
        disabled={disabled}
        onClick={() => onOpen('pinned')}
        title={pinnedOn ? 'Pinned memory' : 'Pin memory'}
        aria-label={pinnedOn ? 'Pinned memory' : 'Pin memory'}
      >
        <span className="settings-chip-icon" aria-hidden="true">
          ∗
        </span>
        <span className="settings-chip-main">{pinnedOn ? 'Pinned' : 'Pin'}</span>
      </button>
    </div>
  );
}

function SheetShell({
  title,
  open,
  onClose,
  onSave,
  saveDisabled,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  children: import('react').ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-sheet-root" role="presentation">
      <button type="button" className="settings-sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="settings-sheet-header">
          <h2>{title}</h2>
          <button type="button" className="settings-sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="settings-sheet-body">{children}</div>
        <footer className="settings-sheet-footer">
          <button type="button" className="settings-sheet-btn is-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="settings-sheet-btn is-primary"
            onClick={onSave}
            disabled={saveDisabled}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

export function MemoryModelSheet({
  open,
  settings,
  modelOptions,
  usageTokens,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: PlayerSettings;
  modelOptions: readonly ChatModelOption[];
  usageTokens: number;
  onClose: () => void;
  onSave: (next: Pick<PlayerSettings, 'model' | 'thinking' | 'memoryLimit'>) => void;
}) {
  const options = modelOptions.length ? modelOptions : CHAT_MODEL_OPTIONS;
  const [modelId, setModelId] = useState(settings.model.id);
  const [thinking, setThinking] = useState<ThinkingLevel>(settings.thinking);
  const [memIdx, setMemIdx] = useState(memoryIndex(settings.memoryLimit));

  useEffect(() => {
    if (!open) return;
    setModelId(settings.model.id);
    setThinking(settings.thinking);
    setMemIdx(memoryIndex(settings.memoryLimit));
  }, [open, settings]);

  const memoryLimit = MEMORY_LIMITS[memIdx] ?? DEFAULT_MEMORY_LIMIT;
  const model =
    options.find((o) => o.id === modelId) ?? options[0] ?? settings.model;

  return (
    <SheetShell
      title="Memory & model"
      open={open}
      onClose={onClose}
      onSave={() => onSave({ model, thinking, memoryLimit })}
    >
      <section className="settings-section">
        <div className="settings-usage">
          <strong>{formatMemoryLabel(usageTokens)}</strong>
          <span>Context usage (estimate)</span>
        </div>
        <div className="settings-field-label">
          <span>Memory depth cap</span>
          <span className="settings-field-value">{formatMemoryLabel(memoryLimit)}</span>
        </div>
        <input
          type="range"
          className="settings-slider"
          min={0}
          max={MEMORY_LIMITS.length - 1}
          step={1}
          value={memIdx}
          onChange={(e) => setMemIdx(Number(e.target.value))}
          aria-label="Memory depth cap"
        />
        <div className="settings-slider-ends">
          <span>{formatMemoryLabel(MEMORY_LIMITS[0])}</span>
          <span>{formatMemoryLabel(MEMORY_LIMITS[MEMORY_LIMITS.length - 1]!)}</span>
        </div>
        <p className="settings-hint">
          How much chat history the character can keep. Effective depth is capped by the model context window.
        </p>
      </section>

      <section className="settings-section">
        <div className="settings-field-label">
          <span>Model</span>
        </div>
        <div className="settings-model-list">
          {options.map((option) => (
            <ModelCard
              key={option.id}
              option={option}
              selected={option.id === model.id}
              onSelect={() => setModelId(option.id)}
              blurb={MODEL_BLURBS[option.id] ?? 'SeaChat chat model'}
            />
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-field-label">
          <span>Thinking depth</span>
        </div>
        <div className="settings-segmented" role="radiogroup" aria-label="Thinking depth">
          {THINKING_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              role="radio"
              aria-checked={thinking === level.id}
              className={thinking === level.id ? 'is-active' : ''}
              title={level.hint}
              onClick={() => setThinking(level.id)}
            >
              {level.label}
            </button>
          ))}
        </div>
        <p className="settings-hint">
          {THINKING_LEVELS.find((l) => l.id === thinking)?.hint}
        </p>
      </section>
    </SheetShell>
  );
}

export function PersonaSheet({
  open,
  persona,
  onClose,
  onSave,
}: {
  open: boolean;
  persona: PlayerPersona;
  onClose: () => void;
  onSave: (persona: PlayerPersona) => void;
}) {
  const [draft, setDraft] = useState(persona);

  useEffect(() => {
    if (open) setDraft(persona);
  }, [open, persona]);

  return (
    <SheetShell
      title="Who I am"
      open={open}
      onClose={onClose}
      onSave={() => onSave(normalizePersona(draft))}
      saveDisabled={!draft.name.trim()}
    >
      <p className="settings-hint is-lead">
        The character will treat you as this persona. Affects the user side only; does not edit the card.
      </p>
      <label className="settings-field">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          maxLength={40}
          placeholder="You"
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
        />
      </label>
      <label className="settings-field">
        <span>Gender</span>
        <select
          value={draft.gender}
          onChange={(e) =>
            setDraft((p) => ({ ...p, gender: e.target.value as PersonaGender }))
          }
        >
          {GENDER_OPTIONS.map((g) => (
            <option key={g.id || 'none'} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Bio</span>
        <textarea
          rows={5}
          value={draft.bio}
          maxLength={800}
          placeholder="Looks, role, relationship to the character… (optional)"
          onChange={(e) => setDraft((p) => ({ ...p, bio: e.target.value }))}
        />
      </label>
    </SheetShell>
  );
}

export function PinnedMemorySheet({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onSave: (pinned: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const count = useMemo(() => Array.from(draft).length, [draft]);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <SheetShell
      title="Pinned memory"
      open={open}
      onClose={onClose}
      onSave={() => onSave(clampPinnedMemory(draft))}
    >
      <p className="settings-hint is-lead">
        The character always prioritizes what you pin here. Use for key facts, agreements, and long-term details.
      </p>
      <label className="settings-field">
        <textarea
          rows={10}
          value={draft}
          placeholder="e.g. My name is Alex, her assistant; we agreed not to talk work on weekends…"
          onChange={(e) => setDraft(clampPinnedMemory(e.target.value))}
        />
        <span className="settings-char-count">
          {count}/{PINNED_MEMORY_MAX_CHARS}
        </span>
      </label>
    </SheetShell>
  );
}

export type { SheetId };
