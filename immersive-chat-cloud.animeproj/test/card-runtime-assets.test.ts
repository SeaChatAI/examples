import { describe, expect, test } from 'bun:test';
import { formatMessageHtml } from '../src/player/message-display.ts';
import cardEnvelope from '../src/card.json';
import { CARD } from './project-card.ts';

describe('embedded card runtime assets', () => {
  test('binds world-info and all three regex ownership modes', () => {
    // b9408ca04: bare regex_scripts stay 'text' (display/storage shaping).
    expect(CARD.protocol).toBe('text');
    expect(CARD.worldInfo).toHaveLength(7);
    expect(CARD.regexScripts).toHaveLength(5);

    const byId = new Map(CARD.regexScripts.map((script) => [script.id, script]));
    expect(byId.get('actor-prompt-wrap-latest-user')).toMatchObject({
      placement: [1],
      promptOnly: true,
      markdownOnly: false,
      minDepth: 0,
      maxDepth: 0,
    });
    expect(byId.get('actor-storage-marker')).toMatchObject({
      placement: [1],
      promptOnly: false,
      markdownOnly: false,
    });
    expect(byId.get('actor-world-info-marker')).toMatchObject({
      placement: [5],
      promptOnly: true,
    });
    expect(byId.get('render-status-block-heading')).toMatchObject({
      placement: [2],
      markdownOnly: true,
    });
  });

  test('display pipeline renders a visible status panel without leaking protocol wrappers', () => {
    const html = formatMessageHtml(cardEnvelope.data.first_mes, {
      role: 'assistant',
      regexScripts: CARD.regexScripts,
    });

    // Real panel (not plain text at end of bubble)
    expect(html).toContain('class="status-panel"');
    expect(html).toContain('class="status-key"');
    expect(html).toContain('>Current Status</strong>');
    expect(html).toContain('>Character Status</strong>');
    expect(html).toContain('>Plot Progress</strong>');
    // Protocol wrappers must not leak as text or escaped entities.
    expect(html).not.toContain('maintext');
    expect(html).not.toMatch(/Status_block/i);
    expect(html).not.toContain('&lt;');
    expect(html).not.toContain('```');
    // Novel path still styles action / dialogue (ST: em + q).
    expect(html).toContain('fmt-action');
    expect(html).toContain('fmt-quote');
  });
});
