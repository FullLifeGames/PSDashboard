import { test, expect, describe } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { correctBattleFromSnapshot } from '../src/branch/corrections';

/**
 * Round 40: the protocol reports only the actives, so a benched body's
 * snapshot HP is its last sighting. 573756: SoulWind's Toxapex left at
 * 213/303 on turn 37 and Regenerator healed it to full off-screen (it
 * re-entered at 303/303 on turn 74), yet the boundary correction wrote the
 * stale 70 % over the sim's heal at every captured turn.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const p1Team: PokemonSet[] = [
  {
    name: 'Toxapex', species: 'Toxapex', item: '', ability: 'Regenerator', moves: ['Haze', 'Recover'],
    nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs, level: 100,
  },
  {
    name: 'Gliscor', species: 'Gliscor', item: '', ability: 'Hyper Cutter', moves: ['Toxic', 'Protect'],
    nature: 'Impish', evs: { hp: 244, atk: 0, def: 252, spa: 0, spd: 12, spe: 0 }, ivs, level: 100,
  },
];
const p2Team: PokemonSet[] = [{
  name: 'Rotom', species: 'Rotom', item: '', ability: 'Levitate', moves: ['Thunderbolt', 'Protect'],
  nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, ivs, level: 100,
}];
const log = [
  '|gametype|singles',
  '|player|p1|Alice||',
  '|player|p2|Bob||',
  '|gen|9',
  '|tier|[Gen 9] OU',
  '|clearpoke',
  '|poke|p1|Toxapex, F|',
  '|poke|p1|Gliscor, M|',
  '|poke|p2|Rotom|',
  '|start',
  '|switch|p1a: Toxapex|Toxapex, F|100/100',
  '|switch|p2a: Rotom|Rotom|100/100',
  '|turn|1',
  '|move|p2a: Rotom|Thunderbolt|p1a: Toxapex',
  '|-supereffective|p1a: Toxapex',
  '|-damage|p1a: Toxapex|40/100',
  '|move|p1a: Toxapex|Haze|p1a: Toxapex',
  '|-clearallboost',
  '|upkeep',
  '|turn|2',
  '|switch|p1a: Gliscor|Gliscor, M|100/100',
  '|move|p2a: Rotom|Thunderbolt|p1a: Gliscor',
  '|-immune|p1a: Gliscor',
  '|upkeep',
  '|turn|3',
].join('\n');

describe('bench HP after a switch-out', () => {
  test("keeps the simulator's Regenerator heal where the protocol stopped seeing the body", async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou', p1Team, p2Team, replayLog: log, targetTurn: 3,
      snapshot: parseReplayLog(log).find(entry => entry.turn === 3) ?? null,
    });
    const battle = runtime.battleStream.battle!;
    const toxapex = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Toxapex')!;
    // 40% at the switch-out, plus the third Regenerator restores: about 73%.
    expect(toxapex.hp / toxapex.maxhp).toBeGreaterThan(0.7);
    expect(toxapex.hp / toxapex.maxhp).toBeLessThan(0.8);

    // The active body is still corrected from the protocol, and a benched faint still lands.
    const snapshot = parseReplayLog(log).find(entry => entry.turn === 3)!;
    const gliscor = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Gliscor')!;
    gliscor.hp = Math.round(gliscor.maxhp / 2);
    const stale = {
      ...snapshot,
      p1: {
        ...snapshot.p1,
        pokemon: snapshot.p1.pokemon.map(pokemon => (pokemon.speciesForme === 'Toxapex'
          ? { ...pokemon, fainted: true, hpPercent: 0, hp: 0 }
          : pokemon)),
      },
    };
    correctBattleFromSnapshot(battle, stale);
    expect(gliscor.hp).toBe(gliscor.maxhp);
    expect(toxapex.fainted).toBe(true);
    expect(toxapex.hp).toBe(0);
  });
});

/**
 * Round 47 (T46): the round-40 rule left a benched body to the sim on the
 * premise that the active was corrected at every boundary before it left.
 * A body that is hit and leaves within the SAME turn never meets a boundary
 * (913994 t5: Rillaboom 100 → 22 %, U-turn, the app read 100 % from then
 * on). The bench now reads the last sighting; a Regenerator holder gets its
 * third on top.
 */
const pivotTeam = (species: 'Scizor' | 'Alomomola'): PokemonSet[] => [
  species === 'Scizor'
    ? {
      name: 'Scizor', species: 'Scizor', item: '', ability: 'Technician', moves: ['U-turn', 'Bullet Punch'],
      nature: 'Adamant', evs: { hp: 248, atk: 252, def: 0, spa: 0, spd: 8, spe: 0 }, ivs, level: 100,
    }
    : {
      name: 'Alomomola', species: 'Alomomola', item: '', ability: 'Regenerator', moves: ['Flip Turn', 'Wish'],
      nature: 'Relaxed', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }, ivs, level: 100,
    },
  p1Team[1],
];
const pivotLog = (species: 'Scizor' | 'Alomomola', gender: string, move: string, hpLeft: number) => [
  '|gametype|singles',
  '|player|p1|Alice||',
  '|player|p2|Bob||',
  '|gen|9',
  '|tier|[Gen 9] OU',
  '|clearpoke',
  `|poke|p1|${species}, ${gender}|`,
  '|poke|p1|Gliscor, M|',
  '|poke|p2|Rotom|',
  '|start',
  `|switch|p1a: ${species}|${species}, ${gender}|100/100`,
  '|switch|p2a: Rotom|Rotom|100/100',
  '|turn|1',
  `|move|p2a: Rotom|Thunderbolt|p1a: ${species}`,
  `|-damage|p1a: ${species}|${hpLeft}/100`,
  `|move|p1a: ${species}|${move}|p2a: Rotom`,
  '|-damage|p2a: Rotom|80/100',
  `|switch|p1a: Gliscor|Gliscor, M|100/100|[from] ${move}`,
  '|upkeep',
  '|turn|2',
  '|move|p2a: Rotom|Protect|p2a: Rotom',
  '|-singleturn|p2a: Rotom|Protect',
  '|move|p1a: Gliscor|Protect|p1a: Gliscor',
  '|-singleturn|p1a: Gliscor|Protect',
  '|upkeep',
  '|turn|3',
].join('\n');

describe('bench HP of a body that was hit and left in the same turn (round 47)', () => {
  const benchFraction = async (species: 'Scizor' | 'Alomomola', log: string, everyBoundary: boolean) => {
    const snapshots = parseReplayLog(log);
    const snapshotFor = (turn: number) => snapshots.find(entry => entry.turn === turn) ?? null;
    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou', p1Team: pivotTeam(species), p2Team, replayLog: log, targetTurn: 3, snapshot: snapshotFor(3),
      ...(everyBoundary ? { capturePositions: { snapshotFor, onPosition: () => {} } } : {}),
    });
    const body = runtime.battleStream.battle!.sides[0].pokemon.find(pokemon => pokemon.species.name === species)!;
    return body.hp / body.maxhp;
  };

  test('the protocol HP at the departure stands, not the sim roll of the hit', async () => {
    // The protocol saw Scizor leave at 22 %; the sim's own Thunderbolt leaves it near 60 %.
    const log = pivotLog('Scizor', 'M', 'U-turn', 22);
    expect(await benchFraction('Scizor', log, false)).toBeCloseTo(0.22, 2);
  });

  test('a Regenerator holder gets its third on top of the last sighting', async () => {
    // Alomomola left at 20 %: 20 % plus a third, whatever the sim rolled for the hit.
    const log = pivotLog('Alomomola', 'F', 'Flip Turn', 20);
    const fraction = await benchFraction('Alomomola', log, false);
    expect(fraction).toBeGreaterThan(0.52);
    expect(fraction).toBeLessThan(0.545);
  });

  test('the bench reads the same with and without a correction at every boundary', async () => {
    // The round-40 premise, pinned: the rule no longer leans on the capture path.
    const log = pivotLog('Scizor', 'M', 'U-turn', 22);
    expect(await benchFraction('Scizor', log, true)).toBeCloseTo(await benchFraction('Scizor', log, false), 8);
  });
});
