import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  advancePosition, advancePositionWithLog, createRootPosition, legalChoices, type SimPosition,
} from '../src/forward-model';
import { searchPosition } from '../src/search';
import { mctsTreeSearch } from '../src/mcts';
import doublesTeams from './fixtures/doubles-identity-fixture';

/**
 * Fork and search identity pins for the history-free fork path (round 31,
 * P3/P2a): the children of a position, its depth-1 matrix search, and one
 * MCTS tree must not move when the fork stops re-parsing the position and
 * starts from an empty log. The reference values were recorded on the code
 * before that change (PERF_IDENTITY_RECORD=1 rewrites them), on two
 * positions with real history: a singles 6v6 three turns in and a doubles
 * 2v2 two turns in. Children are pinned as a hash of their serialized state
 * without the history keys plus readable facts and the advance's log delta.
 */

const RECORD = process.env.PERF_IDENTITY_RECORD === '1';
const FIXTURE = fileURLToPath(new URL('./fixtures/fork-identity.json', import.meta.url));
const SEEDS = ['1,2,3,4', '5,6,7,8'];
/** The keys the history stripping changes by design: the log family and the sim's cursors into it. */
const HISTORY_KEYS = ['log', 'inputLog', 'messageLog', 'sentLogPos', 'lastMoveLine', 'sentRequests', 'sentEnd'];

function makeSet(name: string, species: string, moves: string[], level = 100): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(formatid: string, p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

function makeSixVsSix(): Battle {
  return makeBattle('gen9customgame',
    [
      makeSet('Machamp', 'Machamp', ['Close Combat', 'Knock Off', 'Bullet Punch', 'Protect']),
      makeSet('Snorlax', 'Snorlax', ['Body Slam', 'Earthquake', 'Rest', 'Protect']),
      makeSet('Dragapult', 'Dragapult', ['Dragon Darts', 'U-turn', 'Will-O-Wisp', 'Protect']),
      makeSet('Kyurem', 'Kyurem', ['Draco Meteor', 'Ice Beam', 'Earth Power', 'Protect']),
      makeSet('Corviknight', 'Corviknight', ['Brave Bird', 'Body Press', 'Roost', 'Protect']),
      makeSet('Chansey', 'Chansey', ['Seismic Toss', 'Soft-Boiled', 'Stealth Rock', 'Protect']),
    ],
    [
      makeSet('Garchomp', 'Garchomp', ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Protect']),
      makeSet('Rotom-Wash', 'Rotom-Wash', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Protect']),
      makeSet('Ferrothorn', 'Ferrothorn', ['Power Whip', 'Gyro Ball', 'Spikes', 'Protect']),
      makeSet('Volcarona', 'Volcarona', ['Flamethrower', 'Bug Buzz', 'Quiver Dance', 'Protect']),
      makeSet('Toxapex', 'Toxapex', ['Surf', 'Toxic', 'Recover', 'Protect']),
      makeSet('Tyranitar', 'Tyranitar', ['Stone Edge', 'Crunch', 'Earthquake', 'Protect']),
    ],
  );
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

/** Plays `turns` turns of each side's first legal choice: a position with history behind it. */
function withHistory(root: SimPosition, turns: number): SimPosition {
  let position = root;
  for (let turn = 0; turn < turns; turn++) {
    position = advancePosition(position, legalChoices(position, 'p1')[0].choice, legalChoices(position, 'p2')[0].choice, '1,2,3,4');
  }
  return position;
}

function stripHistory(serialized: string): string {
  const state = JSON.parse(serialized) as Record<string, unknown>;
  for (const key of HISTORY_KEYS) delete state[key];
  return JSON.stringify(state);
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const scrubLog = (lines: string[]) => lines.filter(line => !line.startsWith('|t:|'));

function facts(serialized: string): unknown {
  const state = JSON.parse(serialized) as {
    turn: number; ended: boolean; winner: string; prng: unknown;
    sides: { pokemonLeft: number; active: unknown[]; pokemon: { hp: number; fainted: boolean; status: string }[] }[];
  };
  return {
    turn: state.turn, ended: state.ended, winner: state.winner, prng: state.prng,
    sides: state.sides.map(side => ({
      pokemonLeft: side.pokemonLeft, active: side.active,
      hp: side.pokemon.map(pokemon => pokemon.hp),
      fainted: side.pokemon.map(pokemon => pokemon.fainted),
      status: side.pokemon.map(pokemon => pokemon.status),
    })),
  };
}

function capture(root: SimPosition): unknown {
  const p1Choices = legalChoices(root, 'p1').slice(0, 3);
  const p2Choices = legalChoices(root, 'p2').slice(0, 2);
  expect(p1Choices).toHaveLength(3);
  expect(p2Choices).toHaveLength(2);
  const children = [];
  for (const p1 of p1Choices) {
    for (const p2 of p2Choices) {
      for (const seed of SEEDS) {
        const { child, log } = advancePositionWithLog(root, p1.choice, p2.choice, seed);
        children.push({
          p1: p1.choice, p2: p2.choice, seed,
          state: sha256(stripHistory(child.serialized)),
          facts: facts(child.serialized),
          log: scrubLog(log),
        });
      }
    }
  }
  const settings = { depth: 1 as const, samples: 1 as const, tera: false as const };
  const matrix = searchPosition(root.serialized, { ...settings, mode: 'matrix' });
  const rows = (side: 'p1' | 'p2') => matrix.perSide[side].map(row => ({
    choice: row.choice, ev: row.ev, expected: row.expected, worstCase: row.worstCase, punishedBy: row.punishedBy,
  }));
  const tree = mctsTreeSearch(root.serialized, { ...settings, mode: 'mcts' }, 0);
  return {
    root: sha256(stripHistory(root.serialized)),
    children,
    matrix: { score: matrix.score, interval: matrix.interval, depthCompleted: matrix.depthCompleted, p1: rows('p1'), p2: rows('p2') },
    mcts: {
      score: tree.result.score, visits: tree.visits, depth: tree.depth, rootValue: tree.rootValue,
      p1N: tree.p1N, p1W: tree.p1W, p2N: tree.p2N, p2W: tree.p2W,
      cells: tree.cells.map(cell => [cell.key, cell.visits, cell.total, cell.value, cell.ended]),
    },
  };
}

test.describe('fork and search identity', () => {
  test('children, the depth-1 matrix, and one MCTS tree match the recorded reference', () => {
    test.setTimeout(120_000);
    const singles = withHistory(createRootPosition(serialize(makeSixVsSix())), 3);
    const doubles = withHistory(createRootPosition(serialize(makeBattle('gen9doublescustomgame', doublesTeams.p1Team, doublesTeams.p2Team))), 2);
    // JSON round trip: the fixture cannot tell -0 from 0, and neither should the comparison.
    const captured = JSON.parse(JSON.stringify({ singles: capture(singles), doubles: capture(doubles) })) as unknown;
    if (RECORD) {
      writeFileSync(FIXTURE, JSON.stringify(captured, null, 2) + '\n');
      return;
    }
    expect(captured).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf-8')));
  });
});
