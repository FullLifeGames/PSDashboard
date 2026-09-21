import { test, expect, describe } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLog, type TurnSnapshot } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { correctBattleFromSnapshot } from '../src/branch/corrections';

/**
 * Round 54 (T57): the sim deletes `terastallized` in its faint block. A body
 * that faints only in the reconstruction (a guessed spread, a damage roll)
 * and is revived by the HP correction came back without the marker, while
 * its side had already spent the Tera: 17 of 833 bank positions stood one
 * Tera body short, none over. The snapshot carries the marker per body at
 * every boundary and drops it on a real faint, so it alone decides.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 };
const mon = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Adamant', evs, ivs, level: 100, teraType,
});

const header = (gen: number, tier: string, gametype: 'singles' | 'doubles') => [
  `|gametype|${gametype}`, '|player|p1|Alice||', '|player|p2|Bob||', `|gen|${gen}`, `|tier|${tier}`,
];

const singlesLog = [
  ...header(9, '[Gen 9] OU', 'singles'),
  '|poke|p1|Snorlax, M|', '|poke|p1|Gliscor, M|', '|poke|p2|Chansey, F|', '|start',
  '|switch|p1a: Snorlax|Snorlax, M|100/100',
  '|switch|p2a: Chansey|Chansey, F|100/100',
  '|turn|1',
  '|-terastallize|p1a: Snorlax|Water',
  '|move|p1a: Snorlax|Tackle|p2a: Chansey',
  '|-damage|p2a: Chansey|90/100',
  '|move|p2a: Chansey|Seismic Toss|p1a: Snorlax',
  '|-damage|p1a: Snorlax|80/100',
  '|upkeep', '|turn|2',
].join('\n');

const singlesTeams = {
  p1Team: [mon('Snorlax', 'Immunity', ['Tackle', 'Rest'], 'Water'), mon('Gliscor', 'Hyper Cutter', ['Toxic', 'Protect'], 'Water')],
  p2Team: [mon('Chansey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy')],
};

async function rebuilt(format: string, log: string, teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }) {
  const snapshot = parseReplayLog(log).find(entry => entry.turn === 2)!;
  const runtime = await reconstructBranchRuntime({ format, ...teams, replayLog: log, targetTurn: 2, snapshot });
  return { battle: runtime.battleStream.battle!, snapshot };
}

/**
 * A click the reconstruction never performed: the sim swallowed it (a locked
 * move, Struggle) or answered a rejected choice with its default. The real log
 * carries the |-terastallize| line; dropping it reproduces that sim state, a
 * side whose Tera is still armed. The snapshot stays the full log's.
 */
const withoutTheClick = (log: string) => log.replace('|-terastallize|p1a: Snorlax|Water\n', '');
const fullSnapshot = (log: string) => parseReplayLog(log).find(entry => entry.turn === 2)!;
const teraBudget = (battle: Awaited<ReturnType<typeof rebuilt>>['battle']) =>
  battle.sides[0].pokemon.map(pokemon => pokemon.canTerastallize ?? null);

/** The sim's own faint path, as a guessed spread's damage roll triggers it. */
function faintInTheRebuild(battle: Awaited<ReturnType<typeof rebuilt>>['battle'], species: string) {
  const body = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === species)!;
  body.hp = 0;
  battle.faint(body);
  battle.faintMessages(false, false, false);
  expect(body.terastallized ?? null).toBe(null);
  return body;
}

const withEntry = (snapshot: TurnSnapshot, species: string, patch: Partial<TurnSnapshot['p1']['pokemon'][number]>): TurnSnapshot => ({
  ...snapshot,
  p1: {
    ...snapshot.p1,
    pokemon: snapshot.p1.pokemon.map(pokemon => (pokemon.speciesForme === species ? { ...pokemon, ...patch } : pokemon)),
  },
});

describe('Tera marker after a reconstruction-only faint (round 54)', () => {
  test('the revived body gets its marker back and the side stays spent', async () => {
    const { battle, snapshot } = await rebuilt('gen9ou', singlesLog, singlesTeams);
    const snorlax = faintInTheRebuild(battle, 'Snorlax');

    correctBattleFromSnapshot(battle, snapshot);

    expect(snorlax.fainted).toBe(false);
    expect(snorlax.terastallized).toBe('Water');
    expect(snorlax.getTypes()).toEqual(['Water']);
    expect(battle.sides[0].pokemon.some(pokemon => !!pokemon.canTerastallize)).toBe(false);
  });

  test('doubles: the marker returns to the right body of the pair', async () => {
    const log = [
      ...header(9, '[Gen 9] Doubles OU', 'doubles'),
      '|poke|p1|Snorlax, M|', '|poke|p1|Gliscor, M|', '|poke|p2|Chansey, F|', '|poke|p2|Blissey, F|', '|start',
      '|switch|p1a: Snorlax|Snorlax, M|100/100',
      '|switch|p1b: Gliscor|Gliscor, M|100/100',
      '|switch|p2a: Chansey|Chansey, F|100/100',
      '|switch|p2b: Blissey|Blissey, F|100/100',
      '|turn|1',
      '|-terastallize|p1b: Gliscor|Water',
      '|move|p1b: Gliscor|Protect|p1b: Gliscor',
      '|-singleturn|p1b: Gliscor|Protect',
      '|move|p1a: Snorlax|Tackle|p2a: Chansey',
      '|-damage|p2a: Chansey|90/100',
      '|move|p2a: Chansey|Seismic Toss|p1a: Snorlax',
      '|-damage|p1a: Snorlax|80/100',
      '|move|p2b: Blissey|Seismic Toss|p1a: Snorlax',
      '|-damage|p1a: Snorlax|60/100',
      '|upkeep', '|turn|2',
    ].join('\n');
    const { battle, snapshot } = await rebuilt('gen9doublesou', log, {
      p1Team: singlesTeams.p1Team,
      p2Team: [...singlesTeams.p2Team, mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy')],
    });
    const gliscor = faintInTheRebuild(battle, 'Gliscor');
    const snorlax = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Snorlax')!;

    correctBattleFromSnapshot(battle, snapshot);

    expect(gliscor.terastallized).toBe('Water');
    expect(snorlax.terastallized ?? null).toBe(null);
  });

  test('a benched body gets it back too', async () => {
    const { battle, snapshot } = await rebuilt('gen9ou', singlesLog, singlesTeams);
    const snorlax = faintInTheRebuild(battle, 'Snorlax');
    // The protocol saw the Tera body leave the field alive.
    const benched = withEntry(withEntry(snapshot, 'Snorlax', { isActive: false }), 'Gliscor', { isActive: true });

    correctBattleFromSnapshot(battle, benched);

    expect(snorlax.fainted).toBe(false);
    expect(snorlax.terastallized).toBe('Water');
  });

  test('a click the sim swallowed: the marker lands and the side goes spent', async () => {
    const { battle } = await rebuilt('gen9ou', withoutTheClick(singlesLog), singlesTeams);
    const snorlax = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Snorlax')!;
    snorlax.addedType = 'Grass';
    snorlax.knownType = false;
    expect(teraBudget(battle)).toEqual(['Water', 'Water']);

    correctBattleFromSnapshot(battle, fullSnapshot(singlesLog));

    expect(snorlax.terastallized).toBe('Water');
    expect(teraBudget(battle)).toEqual([null, null]);
    // The rest of BattleActions#terastallize's writes.
    expect([snorlax.addedType, snorlax.knownType, snorlax.apparentType]).toEqual(['', true, 'Water']);
  });

  // The built sets carry the species as the body name, the protocol the nickname.
  test('the entry finds its body by species or by name alone', async () => {
    for (const patch of [{ name: 'Jack Herer' }, { speciesForme: 'Snorlax-Gmax' }]) {
      const { battle, snapshot } = await rebuilt('gen9ou', singlesLog, singlesTeams);
      const snorlax = faintInTheRebuild(battle, 'Snorlax');
      correctBattleFromSnapshot(battle, withEntry(snapshot, 'Snorlax', patch));
      expect(snorlax.terastallized).toBe('Water');
    }
  });

  test('an entry that matches two living bodies is left alone', async () => {
    const { battle, snapshot } = await rebuilt('gen9ou', singlesLog, singlesTeams);
    faintInTheRebuild(battle, 'Snorlax');
    // This entry names Gliscor by species and Snorlax by name.
    const ambiguous = withEntry(withEntry(snapshot, 'Snorlax', { terastallized: '' }),
      'Gliscor', { terastallized: 'Water', name: 'Snorlax' });

    correctBattleFromSnapshot(battle, ambiguous);

    const find = (species: string) => battle.sides[0].pokemon.find(pokemon => pokemon.species.name === species)!;
    expect(find('Snorlax').terastallized ?? null).toBe(null);
    expect(find('Gliscor').terastallized ?? null).toBe(null);
  });

  // The snapshot decides, never the |-terastallize| line: after a real faint
  // (and after Revival Blessing) the body carries no Tera in the game either.
  test('a body the snapshot shows without the marker stays without it', async () => {
    const { battle, snapshot } = await rebuilt('gen9ou', singlesLog, singlesTeams);
    const snorlax = faintInTheRebuild(battle, 'Snorlax');

    correctBattleFromSnapshot(battle, withEntry(snapshot, 'Snorlax', { terastallized: '' }));

    expect(snorlax.fainted).toBe(false);
    expect(snorlax.terastallized ?? null).toBe(null);
    expect(snorlax.getTypes()).toEqual(['Normal']);
  });

  test('a second marker never lands on a side that already carries one', async () => {
    const { battle, snapshot } = await rebuilt('gen9ou', singlesLog, singlesTeams);
    const gliscor = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Gliscor')!;
    // The reconstruction terastallized Snorlax; this snapshot names Gliscor instead.
    const otherBody = withEntry(withEntry(snapshot, 'Snorlax', { terastallized: '' }), 'Gliscor', { terastallized: 'Water' });

    correctBattleFromSnapshot(battle, otherBody);

    expect(gliscor.terastallized ?? null).toBe(null);
  });

  test('no Tera before gen 9, whatever a snapshot claims', async () => {
    const log = singlesLog.replace('|gen|9', '|gen|8').replace('[Gen 9] OU', '[Gen 8] OU').replace('|-terastallize|p1a: Snorlax|Water\n', '');
    const { battle, snapshot } = await rebuilt('gen8ou', log, singlesTeams);
    const snorlax = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Snorlax')!;

    correctBattleFromSnapshot(battle, withEntry(snapshot, 'Snorlax', { terastallized: 'Water' }));

    expect(snorlax.terastallized ?? null).toBe(null);
  });

  // Ogerpon's and Terapagos's click also changes forme, ability and (Terapagos)
  // max HP, and the faint block regresses the forme: a bare marker would
  // leave half a Tera. The marker's loss stays on those bodies; the side's
  // Tera is spent all the same, or the search offers a second one.
  test('Ogerpon gets no bare marker, but its side goes spent', async () => {
    const log = singlesLog.split('Snorlax, M').join('Ogerpon-Wellspring, F').split('Snorlax').join('Ogerpon')
      .replace('|-terastallize|p1a: Ogerpon|Water\n', '');
    const { battle, snapshot } = await rebuilt('gen9ou', log, {
      p1Team: [{ ...mon('Ogerpon-Wellspring', 'Water Absorb', ['Tackle', 'Rest'], 'Water'), item: 'Wellspring Mask' }, singlesTeams.p1Team[1]],
      p2Team: singlesTeams.p2Team,
    });
    const ogerpon = battle.sides[0].pokemon.find(pokemon => pokemon.species.baseSpecies === 'Ogerpon')!;

    expect(teraBudget(battle)).toEqual(['Water', 'Water']);

    correctBattleFromSnapshot(battle, withEntry(snapshot, 'Ogerpon-Wellspring', { terastallized: 'Water' }));

    expect(ogerpon.terastallized ?? null).toBe(null);
    expect(teraBudget(battle)).toEqual([null, null]);
  });

  test('a side with an Illusion holder gets no marker (the protocol names the disguise), but goes spent', async () => {
    const teams = {
      p1Team: [singlesTeams.p1Team[0], mon('Zoroark', 'Illusion', ['Night Daze', 'Protect'], 'Dark')],
      p2Team: singlesTeams.p2Team,
    };
    const log = singlesLog.replace('|poke|p1|Gliscor, M|', '|poke|p1|Zoroark, M|');
    const { battle } = await rebuilt('gen9ou', withoutTheClick(log), teams);
    const snorlax = battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Snorlax')!;
    expect(teraBudget(battle)).toEqual(['Water', 'Dark']);

    correctBattleFromSnapshot(battle, fullSnapshot(log));

    expect(snorlax.terastallized ?? null).toBe(null);
    expect(teraBudget(battle)).toEqual([null, null]);
  });
});
