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
