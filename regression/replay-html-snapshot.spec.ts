import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generateReplayHtml } from '../src/lib/replay-html';

interface ReplayHtmlSnapshot {
  cases: Record<string, Parameters<typeof generateReplayHtml>[0]>;
  out: Record<string, string>;
}

// Captured from the single-template generator before its split into
// sections: the page must stay byte-identical for every option combination
// (no seek, a seek with autoplay and the p2 viewpoint, a turn-0 seek, and a
// log that needs the closing-tag escape).
const snapshot = JSON.parse(
  readFileSync(new URL('./fixtures/replay-html.snapshot.json', import.meta.url), 'utf8'),
) as ReplayHtmlSnapshot;

test.describe('Replay iframe HTML snapshot', () => {
  for (const [name, opts] of Object.entries(snapshot.cases)) {
    test(`renders the ${name} case byte-identically`, () => {
      expect(generateReplayHtml(opts)).toBe(snapshot.out[name]);
    });
  }
});
