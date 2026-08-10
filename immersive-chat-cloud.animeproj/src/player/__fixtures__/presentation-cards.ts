import type { CardDataLike } from '../card-presentation.ts';

export const COVER_CARD: CardDataLike = {
  name: 'Covered Character',
  description: 'Verifies that an imported cover drives both hero art and environment background.',
  scenario: 'Harbor at dawn.',
  extensions: {
    seashort: {
      cover: {
        kind: 'project_asset',
        path: 'public/assets/characters/project-card-cover.png',
      },
      presentation: {
        accent: '#6f8fbb',
        subtitle: 'Harbor morning',
      },
    },
  },
};

export const NO_COVER_CARD: CardDataLike = {
  name: 'No-Cover Character',
  description: 'Verifies letter-mark hero fallback.',
  personality: 'Quiet, sincere.',
  extensions: {
    seashort: {
      presentation: {
        accent: '#9a7b6f',
      },
    },
  },
};

export const LONG_GREETING_CARD: CardDataLike = {
  name: 'Long Greeting Character',
  description: 'Verifies long narrative messages are not truncated by display metadata.',
  first_mes: Array.from({ length: 80 }, (_, index) => `Opening paragraph ${index + 1}.`).join('\n\n'),
};
