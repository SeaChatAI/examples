import { useEffect, useRef, useState } from 'react';
import type { PlayerEngine } from './player-runtime.ts';
import {
  splitReasoningForDisplay,
  stripModelControlTags,
} from './message-display.ts';

export type Phase = 'idle' | 'thinking' | 'writing' | 'done';

export interface TurnPhase {
  phase: Phase;
  reasoning: string;
  text: string;
  thinkMs: number;
}

const EMPTY: TurnPhase = { phase: 'idle', reasoning: '', text: '', thinkMs: 0 };

/**
 * Subscribe to engine reasoning / token channels for the thinking panel and streaming body.
 *
 * DeepSeek often puts full <正文>…</正文> into reasoning_content with empty content.
 * Run splitReasoningBody on accumulated reasoning: panel keeps CoT; body gets narrative text.
 *
 * onUpdate advances phase only on streaming edges; ignore configure-style non-streaming notifies
 * to avoid Maximum update depth exceeded.
 */
export function useTurnPhase(engine: PlayerEngine): TurnPhase {
  const [state, setState] = useState<TurnPhase>(EMPTY);
  const phaseRef = useRef<Phase>('idle');
  const thinkStartRef = useRef(0);
  const thinkMsRef = useRef(0);
  /** Raw reasoning accumulation (may include body tags). */
  const reasoningRawRef = useRef('');
  /** Content-channel accumulation. */
  const contentRawRef = useRef('');
  const reasoningRef = useRef('');
  const textRef = useRef('');
  /** Previous streaming flag for edge detection (true→false = turn end). */
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    const pushIfChanged = () => {
      const next: TurnPhase = {
        phase: phaseRef.current,
        reasoning: reasoningRef.current,
        text: textRef.current,
        thinkMs: thinkMsRef.current,
      };
      setState((prev) => {
        if (
          prev.phase === next.phase
          && prev.reasoning === next.reasoning
          && prev.text === next.text
          && prev.thinkMs === next.thinkMs
        ) {
          return prev;
        }
        return next;
      });
    };

    const enterWriting = () => {
      if (phaseRef.current === 'writing' || phaseRef.current === 'done') return;
      thinkMsRef.current =
        phaseRef.current === 'thinking' ? performance.now() - thinkStartRef.current : 0;
      phaseRef.current = 'writing';
    };

    /** Recompute display reasoning / text from both channel buffers. */
    const recompute = () => {
      const split = splitReasoningForDisplay(reasoningRawRef.current);
      reasoningRef.current = split.reasoning;

      const fromContent = stripModelControlTags(contentRawRef.current);
      const contentHasSubstance = contentRawRef.current.trim().length > 0;

      if (contentHasSubstance && fromContent) {
        textRef.current = fromContent;
      } else if (split.body) {
        textRef.current = split.body;
      } else {
        textRef.current = fromContent;
      }

      if (textRef.current && phaseRef.current !== 'done') {
        enterWriting();
      }
    };

    const offReasoning = engine.onReasoning((delta) => {
      if (phaseRef.current === 'done') return;
      if (phaseRef.current !== 'thinking' && phaseRef.current !== 'writing') {
        phaseRef.current = 'thinking';
        thinkStartRef.current = performance.now();
        reasoningRawRef.current = '';
        contentRawRef.current = '';
      }
      // After writing, trailing reasoning packets with body tags may still arrive — keep accumulating
      reasoningRawRef.current += delta;
      recompute();
      pushIfChanged();
    });

    const offToken = engine.onToken((delta) => {
      if (phaseRef.current === 'done') return;
      if (phaseRef.current !== 'writing' && phaseRef.current !== 'thinking' && phaseRef.current !== 'idle') {
        return;
      }
      if (phaseRef.current !== 'writing') {
        enterWriting();
      }
      contentRawRef.current += delta;
      recompute();
      pushIfChanged();
    });

    const offUpdate = engine.onUpdate(() => {
      const streaming = engine.getSnapshot().streaming;

      if (streaming) {
        // Rising edge: new turn starts — clear previous done buffers
        if (!wasStreamingRef.current && phaseRef.current === 'done') {
          phaseRef.current = 'idle';
          reasoningRawRef.current = '';
          contentRawRef.current = '';
          reasoningRef.current = '';
          textRef.current = '';
          thinkMsRef.current = 0;
          setState(EMPTY);
        }
        wasStreamingRef.current = true;
        return;
      }

      // Falling edge: turn ended (including error/abort when streaming=false)
      if (wasStreamingRef.current) {
        wasStreamingRef.current = false;
        if (phaseRef.current === 'writing' || phaseRef.current === 'thinking') {
          recompute();
          phaseRef.current = 'done';
          pushIfChanged();
        }
        return;
      }

      // Non-edge onUpdate (spurious notify): ignore; do not setState
    });

    // Align with current engine streaming (hot-swap engine)
    wasStreamingRef.current = engine.getSnapshot().streaming;

    return () => {
      offReasoning();
      offToken();
      offUpdate();
    };
  }, [engine]);

  return state;
}
