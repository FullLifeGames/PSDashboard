import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dex } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { pinnedFetcher } from './forced-reconstruction-support';
import { CORPUS } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

/**
 * Round 89 (#75 step 2, ruling 27): the item rung. A knockout that no spread of the set reaches (read by the game's display bounds, step 1) is the
 * log's word that the guessed item is wrong; the solver swaps in the first usage-listed boost item that makes every knockout of the attacker reach.
 * Rows read through the bank's and the app's build with the disk-cached Smogon data (local: skip without `.fit-corpus`):
 *  - VGC 2565721987 turn 6: Iron Bundle's Icy Wind takes Landorus from a shown 100 and the built best roll (Focus Sash, Timid, 252 Special Attack) is
 *    0.857; the best spread alone reaches 0.939. The usage list of Iron Bundle holds Choice Specs, which reaches.
 *  - Guards: Calyrex-Shadow of VGC 2169441191 (the format's usage file has no entry for the species: nothing to offer, the Covert Cloak stays),
 *    Samurott-Hisui of Champions VGC 2670219140 (a single line, below the two observations a solve needs), Chi-Yu of Doubles OU 2694468410 (the
 *    Choice Specs fits Overheat, but the Doubles OU lines leave the fit above the forfeit line, so the prior stands: proposal P8), and
 *    Lopunny-Mega of Gen 6 OU 648453 (an item the species needs is never swapped).
 */
interface Row {
  /** A feedback fixture (tracked, built with its pinned Smogon data) instead of a replay of the local corpus. */
  fixture?: true; id: string; family: string; species: string; side: 'p1' | 'p2';
  /** The item the built set holds: a boost item the rung chose, or the one the build guessed. */
  item: string; boost: boolean;
}

const ROWS: Row[] = [
  { id: 'gen9vgc2026regi-2565721987', family: 'VGC SV', species: 'Iron Bundle', side: 'p1', item: 'Choice Specs', boost: true },
  { id: 'gen9vgc2024regg-2169441191', family: 'VGC SV (guard: no usage entry)', species: 'Calyrex-Shadow', side: 'p1', item: 'Covert Cloak', boost: false },
  { id: 'gen9championsvgc2026regmb-2670219140', family: 'Champions VGC (guard: one line)', species: 'Samurott-Hisui', side: 'p1', item: '', boost: false },
  { id: 'gen9doublesou-2694468410', family: 'Doubles OU (guard: the forfeit rule)', species: 'Chi-Yu', side: 'p2', item: 'Choice Scarf', boost: false },
  { fixture: true, id: 'smogtours-gen6ou-648453', family: 'singles (guard: a Mega Stone)', species: 'Lopunny', side: 'p2', item: 'Lopunnite', boost: false },
];

type Replay = ReplayData & { formatid?: string };
const hooks = ['onModifyAtk', 'onModifySpA', 'onBasePower', 'onModifyDamage'];
const boosts = (name: string) => hooks.some(hook => typeof (Dex.items.get(name) as unknown as Record<string, unknown>)[hook] === 'function');

describe('a knockout no spread reaches gives the attacker a usage-listed boost item (#75)', () => {
  for (const row of ROWS) {
    const path = row.fixture ? join('test', 'e2e-feedback', 'fixtures', `${row.id}.json`) : CORPUS(row.id);
    test.skipIf(!existsSync(path))(`${row.family} ${row.id}: ${row.species} holds ${row.item || 'its guessed item'}`, async () => {
      const replay = JSON.parse(readFileSync(path, 'utf-8')) as Replay;
      const parsed = parseReplayLogWithObservations(replay.log);
      const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? row.id, parsed, fetcher: row.fixture ? pinnedFetcher : diskCachedSmogonFetcher() });
      expect(built.teams).not.toBeNull();
      const set = (row.side === 'p1' ? built.teams!.p1Team : built.teams!.p2Team).find(entry => entry.species.startsWith(row.species));
      expect(set, 'the attacker is in the built team').toBeDefined();
      if (row.item) expect(set!.item).toBe(row.item);
      expect(boosts(set!.item), 'the item is a damage-boost item').toBe(row.boost);
    }, 120_000);
  }
});
