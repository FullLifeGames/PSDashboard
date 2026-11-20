import { expect, test } from 'vitest';
import { NEVER_ACTED_WORDS as ENGINE_WORDS } from '../../packages/eval-engine/src/prose/phrases';
import { NEVER_ACTED_WORDS as ROW_WORDS, neverActedText } from '../../src/components/eval/turn-copy';

/**
 * Round 89 (FT-1): the card's row and the engine's sentences ("..., but Beta was knocked out before it moved, so the log shows no
 * choice") say the same words for a body that fell before it moved. The engine package reaches the app only through its barrel, so
 * the app keeps a copy; this spec holds the two equal.
 */
test('the app row and the engine sentences use one wording for a side knocked out before it moved', () => {
  expect(ROW_WORDS).toBe(ENGINE_WORDS);
  expect(neverActedText({ played: null })).toBe(ENGINE_WORDS);
  expect(neverActedText({ played: { ev: 0 } })).toMatch(new RegExp(`^${ENGINE_WORDS} · staying in \\d+%$`));
});
