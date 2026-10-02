import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex, TeamValidator } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';

/**
 * Round 60 prover (T93, T79): every set the bank build makes for the feedback
 * games passes the simulator's own team validator in the classes ability,
 * item and Tera type (gen<N>ou, custom games skipped). A new class of build
 * error (a new forme in a later gen) shows here without anyone naming it.
 */
const FIXTURES = new URL('../e2e-feedback/fixtures/', import.meta.url);
const CHECKED = /is an invalid ability|can't have [A-Z]|needs to have an ability|please fix its ability|please fix its item|needs to hold |Terastal type/;

const fixtureFetcher = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.replace(/^https:\/\/(data\.pkmn\.cc|pkmn\.github\.io\/smogon\/data)/, '').replace(/\/{2,}/g, '/');
  const file = join(fileURLToPath(FIXTURES), 'smogon', `${path.replace(/[^a-z0-9.]+/gi, '_')}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf-8')) } as unknown as Response;
}) as typeof fetch;

describe('built sets pass the simulator validator (round 60 prover)', () => {
  const files = readdirSync(FIXTURES).filter(name => name.endsWith('.json'));
  for (const file of files) {
    test(file, async () => {
      const replay = JSON.parse(readFileSync(new URL(file, FIXTURES), 'utf-8')) as { log: string; formatid?: string };
      if (/^\|tier\|.*custom game/im.test(replay.log)) return;
      const gen = parseInt(replay.log.match(/^\|gen\|(\d)/m)?.[1] ?? '9', 10);
      const parsed = parseReplayLogWithObservations(replay.log);
      const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? file, parsed, fetcher: fixtureFetcher });
      expect(built.teams).not.toBeNull();
      const validator = TeamValidator.get(`gen${gen}ou`);
      const found: string[] = [];
      for (const set of [...built.teams!.p1Team, ...built.teams!.p2Team]) {
        for (const problem of validator.validateSet(JSON.parse(JSON.stringify(set)), {}) ?? []) {
          if (CHECKED.test(problem)) found.push(`${set.species}: ${problem}`);
        }
        // The validator fills a missing Tera type itself (team-validator.js:599): check the dex directly.
        const species = Dex.forGen(gen).species.get(set.species);
        if (species.requiredTeraType && set.teraType !== species.requiredTeraType) {
          found.push(`${set.species}: Tera type ${set.teraType ?? '-'} instead of ${species.requiredTeraType}`);
        }
      }
      expect(found).toEqual([]);
    }, 120_000);
  }
});
