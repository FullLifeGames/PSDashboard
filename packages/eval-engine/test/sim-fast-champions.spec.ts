import { afterEach, describe, expect, test } from 'vitest';
import { Battle, type PokemonSet, type PRNGSeed } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { serializeBattleStable } from '../src/forward/serialize';
import { resetSimFastForTests, takeSimFastReport } from '../src/forward/sim-fast/state';
import { loadSimMods } from '../src/forward/sim-mods';
import { mctsTreeSearch } from '../src/mcts';
import { SEEDS, stableLog, withSimFast } from './sim-fast-helpers';

/**
 * Round 67 (T145): the speed layer of round 59 (rule tables once per format, battles copied instead of
 * deserialized, the dispatch pre-check) on Champions battles, which carry the mod's scripts as own keys of the
 * battle, its Pokémon and its actions and their own conditions (paralysis, sleep): every lever on gives the
 * battles and logs of the layer off, through two turns under both seeds and through a whole tree search.
 */
// The cases build Champions battles while the suite is collected: load the mod first.
await loadSimMods('gen9championsou');
afterEach(() => resetSimFastForTests());

const ALL_LEVERS = ['rules', 'clone', 'dispatch'] as const;
const set = (species: string, item: string, ability: string, moves: string[], nature: string, evs: number[]): PokemonSet => ({
  name: species, species, item, ability, moves, nature, gender: '', level: 50,
  evs: { hp: evs[0], atk: evs[1], def: evs[2], spa: evs[3], spd: evs[4], spe: evs[5] }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function startedBattle(formatid: string, p1: PokemonSet[], p2: PokemonSet[]): string {
  const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'Alpha', team: p1 }, p2: { name: 'Beta', team: p2 } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.makeChoices(`team ${p1.map((_, i) => i + 1).join('')}`, `team ${p2.map((_, i) => i + 1).join('')}`);
  }
  return serializeBattleStable(battle);
}

const CASES = {
  singles: startedBattle('gen9championsou',
    [set('Venusaur', 'Venusaurite', 'Chlorophyll', ['Giga Drain', 'Sludge Bomb', 'Sleep Powder', 'Protect'], 'Modest', [32, 0, 2, 32, 0, 0]),
      set('Jolteon', 'Leftovers', 'Volt Absorb', ['Thunder Wave', 'Thunderbolt', 'Volt Switch', 'Protect'], 'Timid', [2, 0, 0, 32, 0, 32])],
    [set('Garchomp', 'Life Orb', 'Rough Skin', ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Swords Dance'], 'Jolly', [2, 32, 0, 0, 0, 32]),
      set('Corviknight', 'Leftovers', 'Pressure', ['Body Press', 'Roost', 'Iron Defense', 'Brave Bird'], 'Impish', [32, 0, 32, 0, 2, 0])]),
  doubles: startedBattle('gen9championsdoublescustomgame',
    [set('Charizard', 'Charizardite Y', 'Blaze', ['Heat Wave', 'Air Slash', 'Protect', 'Solar Beam'], 'Timid', [2, 0, 0, 32, 0, 32]),
      set('Kingambit', 'Black Glasses', 'Defiant', ['Kowtow Cleave', 'Sucker Punch', 'Protect', 'Iron Head'], 'Adamant', [32, 32, 0, 0, 2, 0]),
      set('Amoonguss', 'Sitrus Berry', 'Regenerator', ['Spore', 'Rage Powder', 'Pollen Puff', 'Protect'], 'Bold', [32, 0, 32, 0, 2, 0])],
    [set('Incineroar', 'Sitrus Berry', 'Intimidate', ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Knock Off'], 'Careful', [32, 2, 0, 0, 32, 0]),
      set('Garchomp', 'Garchompite', 'Rough Skin', ['Rock Slide', 'Earthquake', 'Protect', 'Dragon Claw'], 'Jolly', [2, 32, 0, 0, 0, 32]),
      set('Raichu', 'Focus Sash', 'Lightning Rod', ['Nuzzle', 'Fake Out', 'Thunderbolt', 'Protect'], 'Timid', [2, 0, 0, 32, 0, 32])]),
};

/** A choice that Mega Evolves when one is offered, else the first legal choice. */
function pick(serialized: string, side: 'p1' | 'p2', seedIndex: number): string {
  const choices = legalChoices(createRootPosition(serialized), side).map(choice => choice.choice);
  return choices.find(choice => choice.includes('mega')) ?? choices[seedIndex % Math.max(choices.length, 1)] ?? 'default';
}

/** Two turns from the start, the battles and the turn logs. */
function played(serialized: string, seed: PRNGSeed, seedIndex: number): string {
  const lines: string[] = [];
  let position = createRootPosition(serialized);
  for (let turn = 0; turn < 2 && !positionBattle(position).ended; turn++) {
    const next = advancePositionWithLog(position, pick(position.serialized, 'p1', seedIndex), pick(position.serialized, 'p2', seedIndex), seed);
    lines.push(next.child.serialized, stableLog(next.log));
    position = next.child;
  }
  return lines.join('\n');
}

describe('the speed layer on Champions battles (T145)', () => {
  for (const [kind, serialized] of Object.entries(CASES)) {
    test(`two turns under both seeds play as with the layer off (${kind})`, () => {
      SEEDS.forEach((seed, index) => {
        const off = withSimFast([], () => played(serialized, seed, index));
        const on = withSimFast(ALL_LEVERS, () => {
          const result = played(serialized, seed, index);
          expect(takeSimFastReport().counters.dispatchCalls, 'the layer ran').toBeGreaterThan(0);
          return result;
        });
        expect(on, `${kind} ${seed}`).toBe(off);
        expect(off, `${kind} ${seed}: a Mega Evolution played`).toContain('|-mega|');
      });
    });

    test(`a tree search gives the result of the layer off (${kind})`, () => {
      const settings = { depth: 1, samples: 1, tera: false, mode: 'mcts', prove: true, ruleset: 'champions' } as const;
      const off = withSimFast([], () => JSON.stringify(mctsTreeSearch(serialized, settings, 0)));
      const on = withSimFast(ALL_LEVERS, () => {
        const result = JSON.stringify(mctsTreeSearch(serialized, settings, 0));
        expect(takeSimFastReport().counters.clones, 'the layer copied battles').toBeGreaterThan(0);
        return result;
      });
      expect(on).toBe(off);
    }, 600_000);
  }
});
