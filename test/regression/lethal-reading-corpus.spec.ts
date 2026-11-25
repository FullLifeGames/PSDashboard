import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { bankTeamsFor } from './bank-build';
import { pinnedFetcher } from './forced-reconstruction-support';
import { CORPUS } from './rebuild-through';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

// Local: the rows skip without `.fit-corpus`.
// The shown HP reads by the game's own display: Scarlet/Violet rounds the percentage up, the Champions mod down.
interface Row { fixture?: true; id: string; family: string; move: string; defender: string; shown: { hp: number; maxhp: number }; attacker: string; check: (attacker: Record<string, number>, defender: Record<string, number>) => void }

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

describe('a knockout the game refutes opens the attacker\'s offense; one it allows stays', () => {
  for (const row of ROWS) {
    const path = row.fixture ? join('test', 'e2e-feedback', 'fixtures', `${row.id}.json`) : CORPUS(row.id);
    test.skipIf(!existsSync(path))(`${row.family} ${row.id}: ${row.attacker}'s ${row.move} on ${row.defender} shown at ${row.shown.hp}/${row.shown.maxhp}`, async () => {
      const replay = JSON.parse(readFileSync(path, 'utf-8')) as Replay;
      const formatId = replay.formatid ?? row.id;
      const parsed = parseReplayLogWithObservations(replay.log);
      const raw = parsed.observations.filter(obs => obs.lethal && obs.moveId === row.move && obs.defenderSpecies.startsWith(row.defender));
      expect(raw.length, 'the knockout is in the parse').toBeGreaterThan(0);
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

// Local: the gen9ou row skips without `.smogon-cache`.
// On the project's calc 28 Special Attack EVs reach the Ogerpon knockout; the Moltres hit fits up to 60 EVs.
describe('the offense of a mon with a knockout and a clean line sits where both fit', () => {
  const FILE = join('test', 'regression', 'fixtures', 'bank-games', 'gen9ou-2658671254.json');
  test.skipIf(!existsSync(FILE) || !existsSync('.smogon-cache'))('gen9ou-2658671254: Iron Valiant\'s Moonblast on Ogerpon (100/100) and on Moltres (100 to 74)', async () => {
    const replay = JSON.parse(readFileSync(FILE, 'utf-8')) as Replay;
    const formatId = replay.formatid ?? 'gen9ou';
    const parsed = parseReplayLogWithObservations(replay.log);
    const knockout = parsed.observations.find(obs => obs.lethal && obs.moveId === 'moonblast' && obs.defenderSpecies.startsWith('Ogerpon') && obs.attackerSpecies === 'Iron Valiant');
    expect(knockout?.defenderShown?.before, 'the turn-15 knockout shows the full body').toEqual({ hp: 100, maxhp: 100 });
    const built = await bankTeamsFor({ log: replay.log, formatId, parsed, fetcher: diskCachedSmogonFetcher() });
    expect(built.teams).not.toBeNull();
    const valiant = built.teams!.p2Team.find(entry => entry.species === 'Iron Valiant')!;
    expect(valiant.evs.spa, 'reaches the knockout').toBeGreaterThanOrEqual(28);
    expect(valiant.evs.spa, 'stays where the hit on Moltres fits (180 before)').toBeLessThanOrEqual(60);
  }, 120_000);
});
