import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NEVER_ACTED_WORDS as ROW_WORDS, neverActedText } from '../../src/components/eval/turn-copy';

/**
 * Round 89 (FT-1): the card's row and the engine's sentences ("..., but Beta was knocked out before it moved, so the log shows no
 * choice") say the same words for a body that fell before it moved. The engine package reaches the app only through its barrel, and
 * root specs import it by name, so the app keeps a copy and this spec reads the engine's constant from its source and holds the two equal.
 */
const phrases = readFileSync(new URL('../../packages/eval-engine/src/prose/phrases.ts', import.meta.url), 'utf-8');
const engineWords = /export const NEVER_ACTED_WORDS =\s*'([^']+)'/.exec(phrases)?.[1];

test('the app row and the engine sentences use one wording for a side knocked out before it moved', () => {
  expect(engineWords).toBeDefined();
  expect(ROW_WORDS).toBe(engineWords);
  expect(neverActedText({ played: null })).toBe(engineWords);
  expect(neverActedText({ played: { ev: 0 } })).toMatch(new RegExp(`^${engineWords} · staying in \\d+%$`));
});
