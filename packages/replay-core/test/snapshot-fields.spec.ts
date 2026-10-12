import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/index';

/**
 * Round 69, T187 and T151 (spec decisions 29 and 30): the snapshot carries what
 * @pkmn/client counts for a sleeping body (statusState.sleepTurns, one per
 * |cant|..|slp| line) and the slot of every active body (side.active). Every
 * log comes from @pkmn/sim; the expected numbers come from that log.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level: 100,
});

function play(format: string, p1: PokemonSet[], p2: PokemonSet[], turns: string[][], seed: number): string {
  const battle = new Battle({
    formatid: toID(format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  for (const [p1Choice, p2Choice] of turns) {
    battle.choose('p1', p1Choice);
    battle.choose('p2', p2Choice);
  }
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

const SINGLES = {
  format: 'gen9customgame',
  p1: [set('Parasect', ['Spore', 'Splash'])],
  p2: [set('Snorlax', ['Splash'])],
  turns: [['move 1', 'move 1'], ...Array.from({ length: 5 }, () => ['move 2', 'move 1'])],
};
const DOUBLES = {
  format: 'gen9doublescustomgame',
  p1: [set('Parasect', ['Spore', 'Splash']), set('Gliscor', ['Splash']), set('Rillaboom', ['Splash'])],
  p2: [set('Snorlax', ['Splash']), set('Corviknight', ['Splash']), set('Amoonguss', ['Splash'])],
  // Spore on the target in p2a, the slot the others keep naming through the sleep.
  turns: [['move 1 1, move 1', 'move 1, move 1'], ...Array.from({ length: 5 }, () => ['move 2, move 1', 'move 1, move 1'])],
};

describe.each([['singles', SINGLES], ['doubles', DOUBLES]] as const)('snapshot fields (%s)', (_label, scene) => {
  test('sleepTurns counts the cant lines while the body sleeps and is absent otherwise', () => {
    let longest = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const log = play(scene.format, scene.p1, scene.p2, scene.turns, seed);
      const { snapshots } = parseReplayLogWithObservations(log);
      for (const snapshot of snapshots) {
        const upTo = log.split('\n');
        upTo.length = upTo.lastIndexOf(`|turn|${snapshot.turn}`) + 1;
        const cants = upTo.filter(line => /^\|cant\|p2a: Snorlax\|slp/.test(line)).length;
        const sleeper = snapshot.p2.pokemon.find(pokemon => pokemon.name === 'Snorlax')!;
        if (sleeper.status === 'slp') {
          expect(sleeper.sleepTurns).toBe(cants);
          longest = Math.max(longest, cants);
        } else {
          expect(sleeper.sleepTurns).toBeUndefined();
        }
        for (const other of snapshot.p1.pokemon) expect(other.sleepTurns).toBeUndefined();
      }
    }
    expect(longest).toBeGreaterThanOrEqual(2);
  });

  test('slot is the index in side.active for an active body and absent on the bench', () => {
    const log = play(scene.format, scene.p1, scene.p2, scene.turns.slice(0, 1), 1);
    const { snapshots } = parseReplayLogWithObservations(log);
    const snapshot = snapshots[snapshots.length - 1];
    const actives = log.split('\n').filter(line => /^\|switch\|/.test(line));
    for (const sideSnapshot of [snapshot.p1, snapshot.p2]) {
      for (const pokemon of sideSnapshot.pokemon) {
        if (!pokemon.isActive) { expect(pokemon.slot).toBeUndefined(); continue; }
        const line = actives.find(entry => entry.split('|')[3].startsWith(pokemon.speciesForme) && entry.split('|')[2].startsWith(sideSnapshot.id))!;
        expect(pokemon.slot).toBe(line.split('|')[2][2].charCodeAt(0) - 'a'.charCodeAt(0));
      }
    }
  });
});

/**
 * Round 69, T158 (spec decision 32): the quick picker needs the facts the simulator's body keeps for the calc:
 * the stat Protosynthesis or Quark Drive raised (the client's `protosynthesis` and `quarkdrive` volatile names it)
 * and the fallen allies of Supreme Overlord (the client's `fallenN` volatile). Battle B is the simulator's own;
 * the expected values come from its body, not from the log.
 */
type SimBattle = InstanceType<typeof Battle>;
function playSteps(format: string, p1: PokemonSet[], p2: PokemonSet[], steps: [string, string][][], seed = 1): { battle: SimBattle; log: string } {
  const battle = new Battle({
    formatid: toID(format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  for (const step of steps) for (const [side, choice] of step) battle.choose(side as 'p1' | 'p2', choice);
  const lines = battle.log;
  return { battle, log: lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n') };
}
const withAbility = (species: string, ability: string, moves: string[], level = 100): PokemonSet => ({ ...set(species, moves), ability, level });
const lastSnapshot = (log: string) => parseReplayLogWithObservations(log).snapshots.at(-1)!;

describe.each([['singles', 'gen9customgame', ''], ['doubles', 'gen9doublescustomgame', ', move 1']] as const)('T158 snapshot facts (%s)', (label, format, partner) => {
  const filler = label === 'singles' ? [] : [set('Gliscor', ['Splash'])];
  const foeFiller = label === 'singles' ? [] : [set('Corviknight', ['Splash'])];

  test('boostedStat is the stat the Protosynthesis and Quark Drive volatile names, and absent without the boost', () => {
    const holders = [
      { ability: 'Protosynthesis', species: 'Roaring Moon', starter: withAbility('Torkoal', 'Drought', ['Splash']), volatile: 'protosynthesis' },
      { ability: 'Quark Drive', species: 'Iron Valiant', starter: withAbility('Pikachu', 'Electric Surge', ['Splash']), volatile: 'quarkdrive' },
    ];
    for (const holder of holders) {
      const { battle, log } = playSteps(format, [withAbility(holder.species, holder.ability, ['Splash']), ...filler], [holder.starter, ...foeFiller], [[['p1', `move 1${partner}`], ['p2', `move 1${partner}`]]]);
      const body = battle.sides[0].pokemon[0];
      const bestStat = (body.volatiles[holder.volatile] as { bestStat?: string } | undefined)?.bestStat;
      expect(bestStat, `${holder.ability} did not start`).toBeTruthy();
      const snapshot = lastSnapshot(log);
      expect(snapshot.p1.pokemon.find(pokemon => pokemon.name === holder.species)!.boostedStat).toBe(bestStat);
      for (const other of [...snapshot.p1.pokemon, ...snapshot.p2.pokemon]) if (other.name !== holder.species) expect(other.boostedStat, other.name).toBeUndefined();
    }
    const quiet = playSteps(format, [withAbility('Roaring Moon', 'Protosynthesis', ['Splash']), ...filler], [set('Snorlax', ['Splash']), ...foeFiller], [[['p1', `move 1${partner}`], ['p2', `move 1${partner}`]]]);
    for (const pokemon of lastSnapshot(quiet.log).p1.pokemon) expect(pokemon.boostedStat).toBeUndefined();
  });

  test('fallen is the count the Supreme Overlord state keeps, and absent for the others', () => {
    // The first body faints to a Psychic and Kingambit comes in from the bench: one fallen ally.
    const p1 = label === 'singles'
      ? [withAbility('Magikarp', 'No Ability', ['Splash'], 5), withAbility('Kingambit', 'Supreme Overlord', ['Splash'])]
      : [withAbility('Magikarp', 'No Ability', ['Splash'], 5), set('Gliscor', ['Splash']), withAbility('Kingambit', 'Supreme Overlord', ['Splash'])];
    const p2 = [set('Mew', ['Psychic', 'Splash']), ...foeFiller];
    const attack = label === 'singles' ? 'move 1' : 'move 1 1, move 1';
    const comeIn = label === 'singles' ? 'switch 2' : 'switch 3';
    const { battle, log } = playSteps(format, p1, p2, [[['p1', `move 1${partner}`], ['p2', attack]], [['p1', comeIn]]]);
    const kingambit = battle.sides[0].pokemon.find(pokemon => pokemon.name === 'Kingambit')!;
    const fallen = (kingambit.abilityState as { fallen?: number }).fallen;
    expect(fallen).toBe(1);
    const snapshot = lastSnapshot(log);
    expect(snapshot.p1.pokemon.find(pokemon => pokemon.name === 'Kingambit')!.fallen).toBe(fallen);
    for (const other of [...snapshot.p1.pokemon, ...snapshot.p2.pokemon]) if (other.name !== 'Kingambit') expect(other.fallen, other.name).toBeUndefined();
  });
});
