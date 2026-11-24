import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { inferOpponentTeam, parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { CORPUS } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

// No row where the reader rightly rules nothing out (a flinch beside a Mold Breaker, a Mega body, a transformed Ditto).

interface Row { id: string; family: string; body: string; ability: string; what: string }

const ROWS: Row[] = [
  { id: 'smogtours-gen9ru-878668', family: 'singles', body: 'Mienshao', ability: 'Inner Focus', what: 'a flinch' },
  { id: 'smogtours-gen9ru-883312', family: 'singles', body: 'Mienshao', ability: 'Inner Focus', what: 'an Intimidate drop' },
  { id: 'gen9doublesou-2661750338', family: 'Doubles OU', body: 'Bisharp', ability: 'Inner Focus', what: 'a flinch' },
  { id: 'gen9doublesou-2543203909-euqqjb3y09m4xb8fjvanwx01h3kkjjxpw', family: 'Doubles OU', body: 'Dragonite', ability: 'Inner Focus', what: 'a copied Intimidate drop' },
  { id: 'gen9doublesou-2661737737', family: 'Doubles OU', body: 'Mamoswine', ability: 'Oblivious', what: 'an Intimidate drop' },
  { id: 'gen9vgc2025regh-2441205662', family: 'VGC SV', body: 'Dragonite', ability: 'Inner Focus', what: 'a flinch' },
  { id: 'gen9vgc2026regf-2531778157', family: 'VGC SV', body: 'Regice', ability: 'Clear Body', what: 'an Intimidate drop' },
  { id: 'gen9championsvgc2026regma-2621914041', family: 'Champions VGC', body: 'Dragonite', ability: 'Inner Focus', what: 'an Intimidate drop' },
  { id: 'gen9championsvgc2026regmbbo3-2687965649', family: 'Champions VGC', body: 'Mamoswine', ability: 'Oblivious', what: 'an Intimidate drop' },
  { id: 'gen9championsvgc2026regmbbo3-2679044618', family: 'Champions VGC', body: 'Dragapult', ability: 'Clear Body', what: 'an Intimidate drop' },
];

type Replay = ReplayData & { formatid?: string };

describe('a landed flinch or drop rules out the ability that refuses it, in the corpus', () => {
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
