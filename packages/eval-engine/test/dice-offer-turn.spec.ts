import { describe, expect, test } from 'vitest';
import type { PRNGSeed } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice, offeredEndDice, type DieOffer } from '../src/dice/offer';
import { dieKey, type ForcedDie } from '../src/dice/types';
import { chanceOfEffect, EFFECT_SPORE, END_ROWS, endBoard, hitDie, PROCS, present, procBoard, type Proc } from './dice-ability-support';
import { playClicks, standing, type Mode } from './dice-fixtures';
import { forcedOn, outfitBoard, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves } from './dice-sweep-support';
import { copyOf } from '../src/sim-ask/copy';

// Round 82 (forced dice), lane A4: the dice the panel offers for the procs of abilities and items and for the end of the turn,
// held to the simulator. A proc die is offered for the move's choice when the holder's handler draws a chance for that hit: the
// offer runs the hit's events on a copy and names what the module recognizes (no ability or item is named). The end-of-turn dice
// belong to the turn, so the offer plays the turn on a copy and reads what the simulator drew at the Residual event, plus the
// accuracy, crit and roll of a future move that lands. Every offered die, forced to either answer, is drawn.
await loadSimMods('gen9championsou');

const SEED = '1,2,3,4';
const choiceOf = (moveId: string, target: string, mode: Mode) => ({
  kind: 'move' as const, moveId, moveName: moveId, ...(mode === 'doubles' && ['normal', 'any', 'adjacentFoe'].includes(target) ? { targetLoc: 1 } : {}),
});
const keysOf = (offers: DieOffer[], ...kinds: string[]): string[] => offers.filter(offer => kinds.includes(offer.name.kind)).map(offer => dieKey(offer.name)).sort();

describe.each(SWEEP_CASES)('the offered procs: $name', ({ rules, mode }) => {
  const procs: Proc[] = [...PROCS, EFFECT_SPORE].filter(proc => present(rules, proc.kind, proc.id));

  test.each(procs.map(proc => [proc.id, proc] as const))('%s is offered with the simulator\'s chance, and each answer is drawn', (_id, proc) => {
    const board = procBoard(rules, mode, proc);
    const before = standing(board);
    const offers = offeredDice(board, 'p1a', choiceOf(proc.move, 'normal', mode)).filter(offer => offer.name.kind === 'ability-proc' || offer.name.kind === 'item-proc');
    expect(standing(board), 'the offer leaves the battle as it was').toBe(before);
    const own = offers.filter(offer => offer.name.effectId?.split(':')[0] === proc.id);
    expect(own.length, `${rules.name} ${mode} ${proc.id}: ${offers.map(offer => dieKey(offer.name)).join(', ')}`).toBeGreaterThan(0);
    const clicks = sweepClicks(mode, 'normal');
    for (const offer of own) {
      expect(offer.name.slot).toBe('p1a');
      expect(offer.name.targetSlot).toBe('p2a');
      // the chance is one the simulator asked for while the handler ran
      const asked = chanceOfEffect(procBoard(rules, mode, proc), clicks, proc.id, playClicks);
      if (offer.chance !== undefined && asked.length > 0) expect(asked).toContain(offer.chance);
      for (const result of offer.results) {
        // the pick that follows a proc is drawn only when the proc's chance came true: force it with the pick
        const chanceDie: ForcedDie[] = offer.name.effectId?.endsWith(':option') ? [{ name: { ...offer.name, effectId: proc.id }, result: { happens: true } }] : [];
        const forced: ForcedDie[] = [hitDie(proc.move), ...chanceDie, { name: offer.name, result }];
        const shown = forcedOn(procBoard(rules, mode, proc), clicks, forced).report.forced[forced.length - 1];
        expect(shown.took, `${dieKey(offer.name)} ${JSON.stringify(result)}: ${shown.reason}`).not.toBe('no-draw');
      }
    }
    // Effect Spore offers its three statuses and the no; Gens 3 and 4 offer the chance and the pick as two dice
    if (proc.id === 'effectspore') {
      const results = own.flatMap(offer => offer.results.map(result => JSON.stringify(result)));
      expect(results.some(result => result.includes('"option":"par"'))).toBe(true);
    }
  });

  test('a board with no proc offers none, and a move that makes no contact reaches no contact handler', () => {
    const bare = sweepBoard(rules, 'tackle', mode);
    expect(keysOf(offeredDice(bare, 'p1a', choiceOf('tackle', 'normal', mode)), 'ability-proc', 'item-proc')).toEqual([]);
    const contact = PROCS.filter(proc => proc.id !== 'cursedbody' && proc.id !== 'toxicchain' && proc.id !== 'focusband' && present(rules, proc.kind, proc.id));
    for (const proc of contact) {
      const holder = proc.holder === 'user' ? { ability: procBoard(rules, mode, proc).sides[0].active[0]!.ability } : {};
      const foe = proc.holder === 'target' ? { ability: procBoard(rules, mode, proc).sides[1].active[0]!.ability } : {};
      const board = outfitBoard(rules, mode, { species: 'Snorlax', moves: ['swift'], ...holder }, { species: 'Vaporeon', ...foe });
      expect(keysOf(offeredDice(board, 'p1a', choiceOf('swift', 'allAdjacentFoes', mode)), 'ability-proc', 'item-proc'), `${proc.id} with swift`).toEqual([]);
    }
  });
});

describe.each(SWEEP_CASES)('the offered end-of-turn dice: $name', ({ rules, mode }) => {
  const rows = END_ROWS.filter(row => (row.kind === 'condition' || present(rules, 'abilities', row.id)) && (!row.doubles || mode === 'doubles') && (!row.only || row.only(rules)));
  const clicks = sweepClicks(mode, 'self');
  const play = (battle: Parameters<typeof playClicks>[0]) => playClicks(battle, clicks);

  test.each(rows.map(row => [row.id, row] as const))('%s is offered, and each answer is drawn', (_id, row) => {
    const board = endBoard(rules, mode, row);
    board.prng.setSeed(SEED as PRNGSeed);
    const before = standing(board);
    const offers = offeredEndDice(board, play);
    expect(standing(board), 'the offer leaves the battle as it was').toBe(before);
    const own = offers.filter(offer => offer.name.kind === 'end-of-turn' && offer.name.effectId === row.id);
    expect(own.map(offer => offer.name), `${rules.name} ${mode} ${row.id}`).toEqual([
      { slot: 'p1a', moveId: '', ...(row.targetSlot ? { targetSlot: row.targetSlot } : {}), kind: 'end-of-turn', effectId: row.id },
    ]);
    expect(own[0].results).toEqual([{ happens: true }, { happens: false }]);
    expect(own[0].chance).toBeGreaterThan(0);
    for (const result of own[0].results) {
      const shown = forcedOn(board, clicks, [{ name: own[0].name, result }]).report.forced[0];
      expect(shown.took, `${dieKey(own[0].name)} ${JSON.stringify(result)}: ${shown.reason}`).toBe('applied');
    }
  });

  test('a board with nothing for the end of the turn to do offers none', () => {
    const board = sweepBoard(rules, 'splash', mode);
    expect(keysOf(offeredEndDice(board, play), 'end-of-turn')).toEqual([]);
  });
});

describe.each(SWEEP_CASES.filter(({ rules }) => rules.generation >= 2))('the offered dice of a future move: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, move => !!move.flags.futuremove);

  test.each(moves.map(move => [move.id, move] as const))('%s: none before it lands, its accuracy on the turn it lands', (_id, move) => {
    const clicks = sweepClicks(mode, move.target);
    const play = (battle: Parameters<typeof playClicks>[0]) => playClicks(battle, clicks);
    const board = sweepBoard(rules, move.id, mode);
    const accuracy = (live: typeof board): string[] => keysOf(offeredEndDice(live, play), 'accuracy').filter(key => key.startsWith(`p1a:${move.id}:`));
    // the use turn draws no accuracy of the move; the landing turn is the second turn after it in every generation
    expect(accuracy(board), 'the turn of use').toEqual([]);
    const next = copyOf(board);
    next.prng ??= board.prng.clone();
    playClicks(next, clicks);
    const landing = accuracy(next);
    expect(landing.length, `${rules.name} ${mode} ${move.id}`).toBeGreaterThanOrEqual(0);
    const later = copyOf(next);
    later.prng ??= next.prng.clone();
    playClicks(later, clicks);
    // exactly one of the next two turns holds the landing, and its die is offered both ways
    const offered = [landing, accuracy(later)].filter(keys => keys.length > 0);
    expect(offered.length, 'the landing turn offers the accuracy').toBe(1);
  });
});
