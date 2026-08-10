import type { TurnPhase } from '../useTurnPhase.ts';
import type { ThinkingLevel } from '../models.ts';

interface ThinkingPanelProps {
  turn: TurnPhase;
  characterName: string;
  /** Kept for call-site compatibility; CoT body is never shown in product UI. */
  thinkingLevel: ThinkingLevel;
}

/**
 * Live thinking status chip only.
 * Product UI never surfaces the model reasoning / CoT body — only the header status
 * ("X is thinking…"). Typing / writing uses the message-live-tag below.
 */
export function ThinkingPanel({ turn, characterName }: ThinkingPanelProps) {
  if (turn.phase !== 'thinking') return null;

  return (
    <aside className="thinking-panel is-live" aria-live="polite">
      <div className="thinking-panel-toggle" role="status">
        <span className="thinking-panel-dot" aria-hidden="true" />
        <span className="thinking-panel-title">{characterName} is thinking…</span>
      </div>
    </aside>
  );
}
