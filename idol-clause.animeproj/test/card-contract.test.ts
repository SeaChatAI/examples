import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cardEnvelope from '../src/card.json';
import { extractStatusPanel } from '../src/message-display.ts';

const data = (cardEnvelope as { data: Record<string, unknown> }).data;
const str = (key: string): string => String(data[key] ?? '');
const greetings = (data.alternate_greetings ?? []) as string[];
const book = data.character_book as { entries: Array<{ keys: string[]; constant?: boolean; content: string }> };

// This card's product contract (playbook rubric + runtime protocol), locked against silent drift.
describe('idol-clause card contract', () => {
  test('adults-only line is present in both instruction slots', () => {
    expect(str('system_prompt')).toContain('adults (21+)');
    expect(str('post_history_instructions')).toContain('adults');
  });

  test('status panel template uses the exact runtime labels', () => {
    for (const label of ['Current Status:', 'Character Status:', 'Plot Progress:']) {
      expect(str('system_prompt')).toContain(label);
    }
    // A sample block written per the template must parse into the runtime panel.
    const sample = [
      'body text',
      '<Status_block>',
      'Current Status: 11:02 PM · greenroom · composed',
      'Character Status: The mask: flawless. Slipped tonight: nothing',
      'Plot Progress: day one · Clause 3: untested',
      '</Status_block>',
    ].join('\n');
    const { status } = extractStatusPanel(sample);
    expect(status?.current).toContain('greenroom');
    expect(status?.plot).toContain('Clause 3');
  });

  test('mask engine keeps the S5 truth gated and calibrates greetings', () => {
    const sp = str('system_prompt');
    expect(sp).toContain('Never volunteer this earlier');
    expect(sp).toContain('GREETING CALIBRATION');
    expect(sp).toContain('every choice is hers alone');
  });

  test('fangs rule points hostility at the world, never her boundaries', () => {
    expect(str('system_prompt')).toContain('never her body, her worth, or her boundaries');
  });

  test('world facts stay consistent across fields', () => {
    const everywhere = [str('description'), str('personality'), str('scenario')].join('\n');
    expect(everywhere).toContain('Clause 3');
    expect(everywhere).toContain('Clause 7');
    const bookText = book.entries.map((e) => e.content).join('\n');
    for (const fact of ['11 months', '40 cities', 'Vivienne Cross', 'Marlowe Street']) {
      expect(bookText).toContain(fact);
    }
  });

  test('trope tags are truthful — no enemies-to-lovers bait', () => {
    const tags = (data.tags ?? []) as string[];
    for (const tag of ['Childhood Friends', 'Forced Proximity', 'Slow Burn', 'Second Chance']) {
      expect(tags).toContain(tag);
    }
    expect(tags).not.toContain('Enemies to Lovers');
  });

  test('world book keys avoid bare high-frequency words', () => {
    const banned = new Set(['check', 'hands', 'attack', 'breathe', 'show', 'perform', 'vale', 'left', 'leave', 'cross', 'seven', 'ears', 'pick', 'label']);
    for (const entry of book.entries) {
      for (const key of entry.keys) {
        expect(banned.has(key.toLowerCase())).toBe(false);
      }
    }
  });

  test('greetings end suspended, never with a question mark', () => {
    for (const greeting of [str('first_mes'), ...greetings]) {
      const tail = greeting.trim().slice(-80);
      expect(tail.endsWith('?')).toBe(false);
      expect(greeting.length).toBeGreaterThan(1200);
    }
  });

  test('cover asset referenced by the card exists', () => {
    const ext = (data.extensions as { seashort?: { cover?: { path?: string } } }).seashort;
    const coverPath = ext?.cover?.path ?? '';
    expect(coverPath).toContain('public/assets/');
    expect(existsSync(join(import.meta.dir, '..', coverPath))).toBe(true);
  });
});
