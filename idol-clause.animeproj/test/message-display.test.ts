import { describe, expect, test } from 'bun:test';
import {
  collectDisplayRegexScripts,
  formatMessageHtml,
  stripModelControlTags,
} from '../src/message-display.ts';

describe('shared player message display (idol-clause shell)', () => {
  test('collects display regex from the project card path defaults', () => {
    const scripts = collectDisplayRegexScripts();
    expect(Array.isArray(scripts)).toBe(true);
  });

  test('formats narrative HTML and strips model control tags', () => {
    const raw = '<think>plan</think>She smiled. "Hello."';
    const cleaned = stripModelControlTags(raw);
    expect(cleaned).not.toContain('think');
    expect(cleaned).toContain('She smiled');
    const html = formatMessageHtml(cleaned, { regexScripts: [] });
    expect(html).toContain('She smiled');
    // Shared player re-exports package formatter — ST quote path must stay live.
    expect(html).toContain('fmt-quote');
  });

  test('protocol Status_block becomes a visible panel (shared package path)', () => {
    const raw = `<maintext>*He turned.*\n「Listen.」</maintext>
<Status_block>
Current Status：night
Character Status：cold
Plot Progress：rules set
</Status_block>`;
    const html = formatMessageHtml(raw, { role: 'assistant', regexScripts: [] });
    expect(html).toContain('class="status-panel"');
    expect(html).toContain('fmt-action');
    expect(html).not.toMatch(/Status_block/i);
    expect(html).not.toContain('maintext');
  });
});
