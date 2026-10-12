import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Battle, Dex, type PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, type TurnSnapshot } from '@fulllifegames/replay-core';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { pickerStateFromSnapshot } from '../../src/lib/picker-state';

/**
 * Round 68 (T186, decision 3 with D8): the snapshot picker builds every species the Champions mod allows. The calculator's
 * Champions generation 0 lacks 35 of them (Aegislash, the Vivillon patterns, Minior-Meteor, the Ogerpon Tera formes, ...),
 * and a name it lacks used to throw into the picker's catch, which fell back to the snapshot's percent-scale HP (maxhp 100
 * or 0). The picker now builds through replay-core's shared builder, so a body's absolute HP is the simulator's for every
 * legal species, on the singles format and on the doubles (VGC) format alike.
 */
const replay = JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', 'gen9championsou-2693832490.json'), 'utf-8')) as { formatid: string; log: string };
const FORMATS = { singles: 'gen9championsou', doubles: 'gen9championsvgc2026regmbbo3' } as const;

function simulatedMaxHp(format: string, set: PokemonSet): number {
  const battle = new Battle({ formatid: format as never, seed: '1,2,3,4', p1: { name: 'A', team: [set] }, p2: { name: 'B', team: [set] } });
  return battle.sides[0].pokemon[0].maxhp;
}

describe('snapshot picker, every legal Champions species', () => {
  for (const [kind, format] of Object.entries(FORMATS)) {
    test(`${kind}: the picker's absolute HP is the simulator's for every species the mod allows`, async () => {
      await loadSimMods(format);
      const snapshot = parseReplayLog(replay.log).find(entry => entry.turn === 3)!;
      const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
      const species = Dex.dexes.champions.species.all().filter(entry => !entry.isNonstandard);
      expect(species.length).toBeGreaterThan(300);
      const wrong: string[] = [];
      for (const entry of species) {
        const mon = { ...snapshot.p1.pokemon.find(candidate => !candidate.fainted)!, speciesForme: entry.name, name: entry.name, maxhp: 100, hp: 100, hpPercent: 100, isActive: true, ability: '' };
        const set = { ...p1Team[0], species: entry.name, name: entry.name, ability: entry.abilities[0] };
        const lone = { ...snapshot, p1: { ...snapshot.p1, pokemon: [mon] }, p2: { ...snapshot.p2, pokemon: snapshot.p2.pokemon.slice(0, 1) } } as TurnSnapshot;
        const info = pickerStateFromSnapshot(lone, [set], p2Team, 9, null, { format: `${format}` }).p1Pokemon[0];
        if (info.maxhp !== simulatedMaxHp(format, set)) wrong.push(`${entry.name} ${info.maxhp}`);
      }
      expect(wrong).toEqual([]);
    }, 120_000);
  }
});
