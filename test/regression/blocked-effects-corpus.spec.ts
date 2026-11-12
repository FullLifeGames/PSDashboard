import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { inferOpponentTeam, parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { CORPUS } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

/**
 * Round 89 (#110): an effect the log shows landing rules out the abilities of the body that would have refused it. Each row is a
 * corpus game of round 88's X1 count where the built ability (the top of the usage stats) blocks an effect the log shows: a
 * Dragonite, Bisharp or Mienshao that flinches, a body that takes an Intimidate drop. (The Champions VGC flinch rows of the count do not read: the
 * flinching Oranguru stood next to a Mold Breaker Tinkaton, the Dragonite of 2651374599 had Mega evolved; Doubles OU 2661677291's Dragonite flinched
 * from a Mold Breaker Excadrill, singles smogtours-gen9ou-677299's Gholdengo took Thunder Wave from a Mold Breaker Tinkaton, and a Ditto that took
 * a burn while transformed holds no proof about its Imposter: the reader rules nothing out for them, as it should.) The row reads the game through the
 * bank's and the app's build with the disk-cached Smogon data (local: the rows skip without `.fit-corpus`): the inference holds
 * the ability in `ruledOut`, and the built set does not carry it. The unit rows and the sweep that holds the reader to the
 * simulator are `packages/replay-core/test/blocked-effects.spec.ts` and `blocked-effects-sweep.spec.ts`; the corpus recount of the
 * events the built sets still block is lane D's `d-x1` probe.
 */

interface Row { id: string; family: string; body: string; ability: string; what: string }

const ROWS: Row[] = [
  { id: 'smogtours-gen9ru-878668', family: 'singles', body: 'Mienshao', ability: 'Inner Focus', what: 'a flinch' },
  { id: 'smogtours-gen9ru-883312', family: 'singles', body: 'Mienshao', ability: 'Inner Focus', what: 'an Intimidate drop' },
  { id: 'gen9doublesou-2661750338', family: 'Doubles OU', body: 'Bisharp', ability: 'Inner Focus', what: 'a flinch' },
  // Turn 5: Mew transformed into Incineroar and its copied Intimidate (named by the log) lowers Dragonite; the first reader skipped a transformed source.
  { id: 'gen9doublesou-2543203909-euqqjb3y09m4xb8fjvanwx01h3kkjjxpw', family: 'Doubles OU', body: 'Dragonite', ability: 'Inner Focus', what: 'a copied Intimidate drop' },
  { id: 'gen9doublesou-2661737737', family: 'Doubles OU', body: 'Mamoswine', ability: 'Oblivious', what: 'an Intimidate drop' },
  { id: 'gen9vgc2025regh-2441205662', family: 'VGC SV', body: 'Dragonite', ability: 'Inner Focus', what: 'a flinch' },
  { id: 'gen9vgc2026regf-2531778157', family: 'VGC SV', body: 'Regice', ability: 'Clear Body', what: 'an Intimidate drop' },
  { id: 'gen9championsvgc2026regma-2621914041', family: 'Champions VGC', body: 'Dragonite', ability: 'Inner Focus', what: 'an Intimidate drop' },
  { id: 'gen9championsvgc2026regmbbo3-2687965649', family: 'Champions VGC', body: 'Mamoswine', ability: 'Oblivious', what: 'an Intimidate drop' },
  { id: 'gen9championsvgc2026regmbbo3-2679044618', family: 'Champions VGC', body: 'Dragapult', ability: 'Clear Body', what: 'an Intimidate drop' },
];

type Replay = ReplayData & { formatid?: string };

describe('a landed flinch or drop rules out the ability that refuses it, in the corpus (#110)', () => {
  for (const row of ROWS) {
    test.skipIf(!existsSync(CORPUS(row.id)))(`${row.family} ${row.id}: ${row.what} on ${row.body} rules out ${row.ability}`, async () => {
      const replay = JSON.parse(readFileSync(CORPUS(row.id), 'utf-8')) as Replay;
      const parsed = parseReplayLogWithObservations(replay.log);
      const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? row.id, parsed, fetcher: diskCachedSmogonFetcher() });
      const ruled = (side: 'p1' | 'p2') => inferOpponentTeam(replay.log, side).pokemon.find(mon => mon.species === row.body)?.ruledOut?.abilities ?? [];
      const side = (['p1', 'p2'] as const).find(entry => ruled(entry).includes(row.ability.toLowerCase().replace(/ /g, '')));
      expect(side, `${row.body} of ${row.id} holds ${row.ability} in no side's rule-outs`).toBeDefined();
      const team = side === 'p1' ? built.teams?.p1Team : built.teams?.p2Team;
      expect(team?.find(entry => entry.species === row.body)?.ability).not.toBe(row.ability);
    }, 120_000);
  }
});
