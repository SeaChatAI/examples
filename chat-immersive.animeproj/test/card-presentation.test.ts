import { describe, expect, test } from 'bun:test';
import {
  cardIdentity,
  deriveCardPresentation,
  projectAssetUrl,
} from '../src/card-presentation.ts';
import {
  CARD_WITH_COVER,
  CARD_WITHOUT_COVER,
  CARD_WITH_LONG_GREETING,
} from '../src/__fixtures__/presentation-cards.ts';

describe('card-driven presentation', () => {
  test('resolves an imported project cover and presentation overrides', () => {
    const presentation = deriveCardPresentation(CARD_WITH_COVER);
    expect(presentation.coverUrl).toBe('/assets/characters/project-card-cover.webp');
    expect(presentation.accent).toBe('#4f9f8b');
    expect(presentation.coverPosition).toBe('64% 22%');
  });

  test('keeps no-cover cards in an explicit fallback state', () => {
    const presentation = deriveCardPresentation(CARD_WITHOUT_COVER);
    expect(presentation.coverUrl).toBeNull();
    expect(presentation.subtitle).toBe('安静，诚恳。');
    expect(presentation.inputPlaceholder).toContain('无封面角色');
  });

  test('rejects non-project and traversal cover paths', () => {
    expect(projectAssetUrl({ kind: 'url', path: 'https://example.com/a.png' })).toBeNull();
    expect(projectAssetUrl({ kind: 'project_asset', path: '../secret.png' })).toBeNull();
    expect(
      projectAssetUrl({ kind: 'project_asset', path: 'public/assets/../secret.png' }),
    ).toBeNull();
  });

  test('uses explicit card_id before mutable card text', () => {
    const first = cardIdentity(CARD_WITH_COVER);
    const second = cardIdentity({ ...CARD_WITH_COVER, description: 'changed' });
    expect(first).toBe(second);
  });

  test('anonymous same-name cards include description and greeting in fallback identity', () => {
    const base = {
      name: '同名角色',
      creator: '',
      character_version: '',
      description: '版本甲',
      first_mes: '你好。',
    };
    expect(cardIdentity(base)).not.toBe(cardIdentity({ ...base, description: '版本乙' }));
    expect(cardIdentity(base)).not.toBe(cardIdentity({ ...base, first_mes: '晚上好。' }));
  });

  test('does not mutate or truncate a long greeting fixture', () => {
    const greeting = CARD_WITH_LONG_GREETING.first_mes;
    deriveCardPresentation(CARD_WITH_LONG_GREETING);
    expect(CARD_WITH_LONG_GREETING.first_mes).toBe(greeting);
    expect(String(greeting).length).toBeGreaterThan(500);
  });
});
