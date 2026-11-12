import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { pinnedFetcher } from './forced-reconstruction-support';
import { CORPUS } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

/**
 * Round 89 (#75 step 1, ruling 27.4): a knockout reads the shown HP by the game's own display (Scarlet/Violet rounds the percentage up, the
 * Champions mod down). The three scenes of the issue's diagnosis (round 88, lane C) read through the bank's and the app's build with the
 * disk-cached Smogon data (local: the rows skip without `.fit-corpus`):
 *  - VGC 2159578969 turn 2: Terapagos-Stellar's Earth Power takes Weezing-Galar from a shown 100, which Scarlet/Violet prints only at full HP, and the
 *    built best roll reached 0.988. The game refutes the built pair. Terapagos' clean lines (Double-Edge, Endeavor) keep its Special Attack, so the
 *    defender's top-up gives up the Special Defense the knockout refutes (136 to 120 EVs) and the pair reaches.
 *  - Champions VGC 2611728375 turn 4: Glimmora's Power Gem takes Basculegion from a shown 49, which the Champions mod prints for 49 percent or more
 *    (it rounds down), and the built best roll reached 0.482. The game refutes it too.
 *  - VGC 2243810213 turn 6, a guard: Palafin-Hero's Jet Punch takes Annihilape from a shown 75; the built best roll deals 138 of its 186 HP, and
 *    Scarlet/Violet prints 75 for 138 and 139. The game allows that knockout (at the top roll only), so the built Palafin stays as it was. The issue
 *    read the 0.742 against a 0.75 and called the set wrong; the round's ruling 27 (4) reads it by the display.
 *  - Gen 6 OU smogtours-648453 turn 4, a singles row: Lopunny-Mega's High Jump Kick takes Rotom-Wash from its exact 219 of 303 HP (a Gen 6 replay
 *    of the player's own side prints exact HP). The old pair's best roll is 216 and the old reading's 2 % slack hid that; no rung reaches 219 with
 *    the Fake Out line of turn 2 beside it, but the refutation now pulls the defender one rung down (Defense 252 to 244). Round 89's gate rows
 *    (`lanes/D/d7-gate-rows.md`) carry the rebuild fingerprint this moves.
 * Doubles and VGC are the rows above; singles also have the unit rows of `packages/replay-core/test/lethal-reading.spec.ts`; the corpus rows are the doubles and VGC scenes.
 */
interface Row { /** A feedback fixture (tracked, built with its pinned Smogon data) instead of a replay of the local corpus. */ fixture?: true; id: string; family: string; move: string; defender: string; shown: { hp: number; maxhp: number }; attacker: string; check: (attacker: Record<string, number>, defender: Record<string, number>) => void }

const ROWS: Row[] = [
  {
    id: 'gen9vgc2024regg-2159578969', family: 'VGC SV', move: 'earthpower', defender: 'Weezing', shown: { hp: 100, maxhp: 100 }, attacker: 'Terapagos',
    check: (_, defender) => expect(defender.spd, 'the defender gives up the Special Defense the knockout refutes (136 before)').toBeLessThan(136),
  },
  {
    id: 'gen9championsvgc2026regmabo3-2611728375', family: 'Champions VGC', move: 'powergem', defender: 'Basculegion', shown: { hp: 49, maxhp: 100 }, attacker: 'Glimmora',
    check: attacker => expect(attacker.spa, 'Glimmora\'s Special Attack (2 Stat Points before)').toBeGreaterThan(2),
  },
  {
    id: 'gen9vgc2024regh-2243810213', family: 'VGC SV (guard)', move: 'jetpunch', defender: 'Annihilape', shown: { hp: 75, maxhp: 100 }, attacker: 'Palafin',
    check: (attacker, defender) => {
      expect(attacker.atk, 'Palafin keeps its 252 Attack').toBe(252);
      expect(defender.hp, 'Annihilape keeps its 4 HP EVs (186 HP): the shown 75 allows 138, the best roll').toBe(4);
    },
  },
  {
    fixture: true, id: 'smogtours-gen6ou-648453', family: 'singles', move: 'highjumpkick', defender: 'Rotom-Wash', shown: { hp: 219, maxhp: 303 }, attacker: 'Lopunny',
    check: (attacker, defender) => {
      expect(attacker.atk, 'Lopunny keeps its 252 Attack (no rung of the attacker reaches either)').toBe(252);
      expect(defender.def, 'Rotom-Wash gives up Defense: the log shows its exact 219 HP, and the best roll of the old pair (252 Defense) is 216').toBeLessThan(252);
    },
  },
];

type Replay = ReplayData & { formatid?: string };

describe('a knockout the game refutes opens the attacker\'s offense; one it allows stays (#75)', () => {
  for (const row of ROWS) {
    const path = row.fixture ? join('test', 'e2e-feedback', 'fixtures', `${row.id}.json`) : CORPUS(row.id);
    test.skipIf(!existsSync(path))(`${row.family} ${row.id}: ${row.attacker}'s ${row.move} on ${row.defender} shown at ${row.shown.hp}/${row.shown.maxhp}`, async () => {
      const replay = JSON.parse(readFileSync(path, 'utf-8')) as Replay;
      const formatId = replay.formatid ?? row.id;
      const parsed = parseReplayLogWithObservations(replay.log);
      const raw = parsed.observations.filter(obs => obs.lethal && obs.moveId === row.move && obs.defenderSpecies.startsWith(row.defender));
      expect(raw.length, 'the knockout is in the parse').toBeGreaterThan(0);
      // The parse keeps the text the log showed before the hit.
      expect(raw.some(obs => obs.defenderShown?.before.hp === row.shown.hp && obs.defenderShown.before.maxhp === row.shown.maxhp)).toBe(true);
      const built = await bankTeamsFor({ log: replay.log, formatId, parsed, fetcher: row.fixture ? pinnedFetcher : diskCachedSmogonFetcher() });
      expect(built.teams).not.toBeNull();
      let checked = 0;
      for (const side of [built.teams!.p1Team, built.teams!.p2Team]) {
        const set = side.find(entry => entry.species === row.attacker);
        const foe = (side === built.teams!.p1Team ? built.teams!.p2Team : built.teams!.p1Team).find(entry => entry.species.startsWith(row.defender));
        if (!set || !foe) continue;
        row.check(set.evs as unknown as Record<string, number>, foe.evs as unknown as Record<string, number>);
        checked += 1;
      }
      expect(checked, 'the attacker and its victim are in the built teams').toBeGreaterThan(0);
    }, 120_000);
  }
});
