import { writeFileSync } from 'node:fs';
import { State, type Battle, type PRNGSeed } from '@pkmn/sim';
import { afterAll, describe, expect, test } from 'vitest';
import { recordTurn } from '../src/dice/flip';
import { endgameChildren } from '../src/endgame/children';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { CHAMPIONS, sweepSelection, type Rules } from './dice-fixtures';
import { dexOfRules, outfitBoard, SWEEP_CASES, sweepClicks, type DexMove, type SecondaryEntry } from './dice-sweep-support';
import { chancesCalled, liveState, turnOf } from './flip-turn-support';

await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
afterAll(() => {
  if (logPath) writeFileSync(logPath, `${JSON.stringify(tallies)}\n`, 'utf8');
});

const SEEDS = ['1,2,3,4', '5,6,7,8'];

type Clicks = { p1: string; p2: string };

const ruleset = (rules: Rules): 'champions' | 'standard' => (rules === CHAMPIONS ? 'champions' : 'standard');
const positionOf = (board: Battle, rules: Rules) => createRootPosition(JSON.stringify(State.serializeBattle(board)), ruleset(rules));

function choicesOf(board: Battle, clicks: Clicks): [string, string] {
  const choice = (side: 0 | 1, click: string): string => click.split(',').map((part, position) => {
    const [, index, aim] = part.trim().split(' ');
    const mon = board.sides[side].active[position]!;
    return `move ${mon.moveSlots[Number(index) - 1].id}${aim ? ` ${aim}` : ''}`;
  }).join(', ');
  return [choice(0, clicks.p1), choice(1, clicks.p2)];
}

function cellOf(board: Battle, rules: Rules, clicks: Clicks) {
  const before = liveState(board);
  const [p1Choice, p2Choice] = choicesOf(board, clicks);
  const cell = endgameChildren(positionOf(board, rules), p1Choice, p2Choice, 6);
  expect(liveState(board), 'the live board').toBe(before);
  return { cell, shares: cell.children.map(child => child.share).sort((a, b) => a - b) };
}

const seeded = (board: Battle, seed: string): Battle => {
  board.prng.setSeed(seed as PRNGSeed);
  return board;
};

function twoHitMoves(rules: Rules, keep: (move: DexMove) => boolean): DexMove[] {
  const dex = dexOfRules(rules);
  return dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
    && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past')
    && move.multihit === 2 && move.accuracy === 100 && ['normal', 'any', 'adjacentFoe'].includes(move.target) && !move.flags.charge && keep(move));
}

const entriesOf = (move: DexMove): SecondaryEntry[] => ((move as unknown as { secondaries?: SecondaryEntry[] }).secondaries ?? []);
const hitsShown = (battle: Battle, start: number): number[] => battle.log.slice(start).filter(line => line.startsWith('|-hitcount|')).map(line => Number(line.split('|')[3]));

function hitAbilities(rules: Rules) {
  const dex = dexOfRules(rules);
  return dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && (ability.isNonstandard === null || ability.isNonstandard === undefined)
    && ['onDamagingHit', 'onSourceDamagingHit', 'onAfterMoveSecondary', 'onModifyMove', 'onSourceModifyDamage', 'onHit'].some(key => key in ability));
}

const tallies = { repeated: 0, guards: 0, secondaries: 0, once: 0 };

describe.each(SWEEP_CASES.filter(entry => entry.rules.generation >= 3))('a contact proc on every hit: $name', ({ rules, mode, name }) => {
  const moves = twoHitMoves(rules, move => !!move.flags.contact && entriesOf(move).length === 0);
  const abilities = hitAbilities(rules);

  test('the rule set has a two-hit contact move', () => expect(moves.length, name).toBeGreaterThan(0));

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    const clicks = sweepClicks(mode, move.target);
    const guard = sweepClicks(mode, 'normal');
    for (const ability of abilities) {
      for (const holder of ['target', 'user'] as const) {
        const outfit = { ability: ability.name };
        const make = (moveId: string): Battle => holder === 'user'
          ? outfitBoard(rules, mode, { species: 'Snorlax', moves: [moveId], ...outfit }, { species: 'Vaporeon' })
          : outfitBoard(rules, mode, { species: 'Snorlax', moves: [moveId] }, { species: 'Vaporeon', ...outfit });
        const asked = (moveId: string) => chancesCalled(seeded(make(moveId), SEEDS[0]), clicks).filter(entry => entry.effect === ability.id && entry.chance > 0 && entry.chance < 1);
        const twice = asked(move.id);
        if (twice.length < 2) continue;
        const chance = twice[0].chance;
        expect(new Set(twice.map(entry => entry.chance)).size, `${name} ${ability.id} ${move.id} one chance per hit`).toBe(1);
        for (const seed of SEEDS) {
          const board = seeded(make(move.id), seed);
          const { cell } = cellOf(board, rules, clicks);
          if (cell.plain) {
            expect(cell.unpriced, `${name} ${ability.id} on the ${holder} against ${move.id} ${seed}: priced with the first draw (${chance})`).toBe(true);
            expect(cell.children, `${name} ${ability.id} ${move.id} one child`).toHaveLength(1);
          }
          const recorded = recordTurn(turnOf(board, clicks));
          expect(recorded.repeated.some(die => die.name.effectId === ability.id && die.chance === chance), `${name} ${ability.id} ${move.id} ${seed} listed as repeated`).toBe(true);
          expect(recorded.dice.some(die => die.name.effectId === ability.id), `${name} ${ability.id} ${move.id} ${seed} not priced`).toBe(false);
        }
        tallies.repeated++;
        const once = asked('tackle');
        if (once.length !== 1) continue;
        const board = seeded(make('tackle'), SEEDS[0]);
        const { cell, shares } = cellOf(board, rules, guard);
        if (!cell.plain || cell.unpriced) continue;
        if (shares.length === 2) {
          const [low, high] = once[0].chance < 0.5 ? [once[0].chance, 1 - once[0].chance] : [1 - once[0].chance, once[0].chance];
          expect(shares[0], `${name} ${ability.id} guard low`).toBeCloseTo(low, 12);
          expect(shares[1], `${name} ${ability.id} guard high`).toBeCloseTo(high, 12);
          tallies.guards++;
        }
      }
    }
  });
});

// Gens 1 and 2 roll a two-hit move's secondary once, on the last hit; Gens 3 and up roll it on every hit.
const rollsOncePerMove = (rules: Rules): boolean => rules.generation <= 2;

describe.each(SWEEP_CASES)('a secondary on every hit: $name', ({ rules, mode, name }) => {
  const moves = twoHitMoves(rules, move => entriesOf(move).some(entry => entry.chance !== undefined && entry.chance > 0 && entry.chance < 100));

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    const clicks = sweepClicks(mode, move.target);
    for (const seed of sweepSelection(SEEDS, 'seeds')) {
      const board = seeded(outfitBoard(rules, mode, { species: 'Snorlax', moves: [move.id] }, { species: 'Vaporeon' }), seed);
      const { cell } = cellOf(board, rules, clicks);
      const recorded = recordTurn(turnOf(board, clicks));
      expect(hitsShown(recorded.battle, recorded.logStart), `${name} ${move.id} both hits`).toEqual([2]);
      if (rollsOncePerMove(rules)) {
        expect(recorded.repeated, `${name} ${move.id} ${seed} no repeated die`).toEqual([]);
        const rolls = recorded.dice.filter(die => die.name.kind === 'secondary');
        expect(rolls, `${name} ${move.id} ${seed} one priced secondary`).toHaveLength(1);
        if (cell.plain) expect(cell.unpriced, `${name} ${move.id} ${seed} priced`).toBe(false);
        tallies.once++;
        continue;
      }
      if (cell.plain) {
        expect(cell.unpriced, `${name} ${move.id} ${seed}: priced with the first draw`).toBe(true);
        expect(cell.children).toHaveLength(1);
      }
      expect(recorded.repeated.some(die => die.name.kind === 'secondary'), `${name} ${move.id} ${seed} listed as repeated`).toBe(true);
      expect(recorded.dice.some(die => die.name.kind === 'secondary'), `${name} ${move.id} ${seed} not priced`).toBe(false);
      tallies.secondaries++;
    }
  });
});

describe('the sweep exercised its rows', () => {
  test('contact procs, guards and secondaries were played', () => {
    expect(tallies.repeated, 'repeated procs').toBeGreaterThan(0);
    expect(tallies.guards, 'guards').toBeGreaterThan(0);
    expect(tallies.secondaries, 'secondaries').toBeGreaterThan(0);
    expect(tallies.once, 'Gens 1 and 2 roll once').toBeGreaterThan(0);
  });
});
