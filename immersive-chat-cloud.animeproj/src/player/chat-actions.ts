import type { PlayerEngine } from './player-runtime.ts';

interface ChatMutationEngine {
  retryLast?: (options?: { signal?: AbortSignal }) => Promise<void>;
  backtrackLast?: (options?: { signal?: AbortSignal }) => boolean | Promise<boolean>;
  continueLast?: (options?: { signal?: AbortSignal }) => Promise<void>;
}

export interface ChatActions {
  canRetry: boolean;
  canBacktrack: boolean;
  canContinue: boolean;
  retry(signal?: AbortSignal): Promise<void>;
  backtrack(signal?: AbortSignal): Promise<boolean>;
  continue(signal?: AbortSignal): Promise<void>;
}

/** Runtime capability adapter keeps the template compatible while file: SDK copies refresh. */
export function chatActions(engine: PlayerEngine): ChatActions {
  const mutationEngine = engine as unknown as ChatMutationEngine;
  return {
    canRetry: typeof mutationEngine.retryLast === 'function',
    canBacktrack: typeof mutationEngine.backtrackLast === 'function',
    canContinue: typeof mutationEngine.continueLast === 'function',
    retry: (signal) => {
      if (!mutationEngine.retryLast) return Promise.reject(new Error('This runtime does not support regenerate'));
      return mutationEngine.retryLast({ signal });
    },
    backtrack: async (signal) => {
      if (!mutationEngine.backtrackLast) return false;
      return await mutationEngine.backtrackLast({ signal });
    },
    continue: (signal) => {
      if (!mutationEngine.continueLast) return Promise.reject(new Error('This runtime does not support continue'));
      return mutationEngine.continueLast({ signal });
    },
  };
}
