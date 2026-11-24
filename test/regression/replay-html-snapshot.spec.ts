import { test, expect, describe } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { generateReplayHtml } from '../../src/lib/replay-html';

interface ReplayHtmlSnapshot {
  cases: Record<string, Parameters<typeof generateReplayHtml>[0]>;
  out: Record<string, string>;
}

// Change the template on purpose: rerun with UPDATE_REPLAY_HTML_SNAPSHOT=1 and review the fixture diff.
const fixtureUrl = new URL('./fixtures/replay-html.snapshot.json', import.meta.url);
const snapshot = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as ReplayHtmlSnapshot;

if (process.env.UPDATE_REPLAY_HTML_SNAPSHOT) {
  snapshot.out = Object.fromEntries(
    Object.entries(snapshot.cases).map(([name, opts]) => [name, generateReplayHtml(opts)]),
  );
  writeFileSync(fixtureUrl, `${JSON.stringify(snapshot, null, 2)}\n`);
}

describe('Replay iframe HTML snapshot', () => {
  for (const [name, opts] of Object.entries(snapshot.cases)) {
    test(`renders the ${name} case byte-identically`, () => {
      expect(generateReplayHtml(opts)).toBe(snapshot.out[name]);
    });
  }
});
