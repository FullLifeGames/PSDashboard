import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice, type DieOffer } from '../src/dice/offer';
import { RecordingPRNG } from '../src/dice/prng';
import { dieKey, type DieResult, type ForcedDie } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, standing, type Mode, type Rules } from './dice-fixtures';
import {
  clicksAccepted, dexOfRules, forcedOn, isCharge, newTally, outfitBoard, picksOne, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves, type DexMove, type Tally,
} from './dice-sweep-support';

await loadSimMods('gen9championsou');

const FAST = 'Pikachu';
const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);
const OFFERED_KINDS = new Set(['accuracy', 'crit', 'damage-roll', 'secondary', 'self-effect', 'hit-count', 'stalling', 'power']);

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const choiceOf = (move: DexMove, mode: Mode) => ({
  kind: 'move' as const, moveId: move.id, moveName: move.name, ...(mode === 'doubles' && NEEDS_AIM.has(move.target) ? { targetLoc: 1 } : {}),
});

const firstOf = (offer: DieOffer): DieResult => offer.results[0];

function drawnKeys(board: ReturnType<typeof sweepBoard>, clicks: { p1: string; p2: string }, moveId: string): string[] {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const watch = watchBattle(copy);
  const recording = new RecordingPRNG(copy.prng, watch);
  copy.prng = recording;
  try {
    playClicks(copy, clicks);
  } finally {
    watch.uninstall();
  }
  return [...recording.record.keys()].filter(key => key.startsWith(`p1a:${moveId}:`));
}

function exercise(rules: Rules, mode: Mode, move: DexMove, tally: Tally): string[] {
  const board = sweepBoard(rules, move.id, mode, '1,2,3,4', false, FAST);
  let clicks = sweepClicks(mode, move.target);
  if (isCharge(move)) {
    expect(offeredDice(board, 'p1a', choiceOf(move, mode)), `${move.id} charging`).toEqual([]);
    playClicks(board, clicks);
    clicks = sweepClicks(mode, move.target, true);
  }
  if (!clicksAccepted(board, clicks) || move.flags.futuremove) return [];
  const before = standing(board);
  const offers = offeredDice(board, 'p1a', choiceOf(move, mode));
  expect(standing(board), `${move.id} offer leaves the battle as it was`).toBe(before);
  tally.cases++;
  const problems: string[] = [];
  const offered = new Set(offers.map(offer => dieKey(offer.name)));
  const dexMove = move as unknown as { multiaccuracy?: boolean };
  const extra = dexMove.multiaccuracy ? ['5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20'].flatMap(seed => drawnKeys(sweepBoard(rules, move.id, mode, seed, false, FAST), clicks, move.id)) : [];
  for (const key of new Set([...drawnKeys(board, clicks, move.id), ...extra])) {
    const [, , target, kind] = key.split(':');
    // A die the state cannot name before the hit stays unoffered: a self effect set in the move's own `onTryHit`,
    // and an accuracy aimed at the user (a move that works through its own condition: Bide, Nature Power).
    const lateSelf = kind === 'self-effect' && typeof (dexOfRules(rules).moves.get(move.id) as unknown as { onTryHit?: unknown }).onTryHit === 'function';
    if (OFFERED_KINDS.has(kind) && !offered.has(key) && !lateSelf && target !== 'p1a') problems.push(`drawn but not offered: ${key}`);
  }
  if (offers.length === 0) return problems;
  const forced: ForcedDie[] = offers.map(offer => ({ name: offer.name, result: offer.name.kind === 'accuracy' ? { happens: true } : firstOf(offer) }));
  const { report } = forcedOn(board, clicks, forced);
  const phantoms = report.forced.filter(shown => shown.took === 'no-draw' && /^the simulator drew no/.test(shown.reason ?? ''));
  tally.applied += report.forced.length;
  const sameDie = (a: ForcedDie, b: ForcedDie): boolean => a.name.kind === b.name.kind && a.name.effectId === b.name.effectId;
  for (const shown of phantoms) {
    const pickedElsewhere = picksOne(move.target) && report.forced.some(other => sameDie(other.die, shown.die) && !phantoms.includes(other));
    if (!pickedElsewhere) problems.push(`offered but never drawn: ${dieKey(shown.die.name)} (${shown.reason})`);
  }
  return problems;
}

describe.each(SWEEP_CASES)('the offered dice: $name', ({ rules, mode, name }) => {
  const { moves } = sweepMoves(rules, () => true, false);
  const tally: Tally = newTally();

  test.each(moves.map(move => [move.id, move] as const))('%s', (_id, move) => {
    expect(exercise(rules, mode, move, tally), `${rules.name} ${mode} ${move.id}`).toEqual([]);
  });

  test('the offer was exercised', () => {
    summaries.push(`${name}: ${moves.length} moves ${JSON.stringify({ ...tally, bad: undefined, unexercised: undefined })}`);
    expect(tally.cases).toBeGreaterThan(moves.length * 0.8);
    expect(tally.applied).toBeGreaterThan(moves.length);
  });
});

const has = (rules: Rules, kind: 'items' | 'abilities', id: string): boolean => {
  const dex = dexOfRules(rules);
  const entry = dex[kind].get(id);
  return entry.exists && entry.gen <= dex.gen && !entry.isNonstandard;
};
const kindsOf = (offers: DieOffer[]): string[] => offers.map(offer => `${offer.name.kind}${offer.name.effectId ? `:${offer.name.effectId}` : ''}`);
const played = new Map<string, number>();
const play = (row: string): void => void played.set(row, (played.get(row) ?? 0) + 1);

describe.each(SWEEP_CASES)('the offer follows the state: $name', ({ rules, mode }) => {
  const choice = (move: string) => ({ kind: 'move' as const, moveId: move, moveName: move, ...(mode === 'doubles' ? { targetLoc: 1 } : {}) });
  const offerOn = (move: string, a: { item?: string; ability?: string } = {}, t: { item?: string; ability?: string } = {}) =>
    offeredDice(outfitBoard(rules, mode, { species: FAST, moves: [move], ...a }, { species: 'Vaporeon', ...t }), 'p1a', choice(move));

  test('a switch offers no die', () => {
    const board = outfitBoard(rules, mode, { species: FAST, moves: ['tackle'] }, { species: 'Vaporeon' });
    expect(offeredDice(board, 'p1a', { kind: 'switch', speciesId: 'vaporeon', pokemonName: 'Vaporeon' })).toEqual([]);
  });

  test('an item that adds a flinch to a move with none offers the flinch die', () => {
    if (!has(rules, 'items', 'kingsrock')) return;
    play('kingsrock');
    expect(kindsOf(offerOn('tackle')), 'without the item').not.toContain('secondary:flinch');
    expect(kindsOf(offerOn('tackle', { item: 'King\'s Rock' }))).toContain('secondary:flinch');
  });

  test('Serene Grace doubles the chance the offer names, Shield Dust and Sheer Force leave no secondary die', () => {
    if (rules.generation < 5 || !has(rules, 'abilities', 'sheerforce')) return;
    play('abilities');
    const plain = offerOn('thunderbolt').find(offer => offer.name.kind === 'secondary')!;
    const doubled = offerOn('thunderbolt', { ability: 'Serene Grace' }).find(offer => offer.name.kind === 'secondary')!;
    expect(doubled.chance).toBeCloseTo(plain.chance! * 2, 5);
    expect(kindsOf(offerOn('thunderbolt', {}, { ability: 'Shield Dust' }))).not.toContain('secondary:par');
    expect(kindsOf(offerOn('thunderbolt', { ability: 'Sheer Force' }))).not.toContain('secondary:par');
  });

  test('Skill Link fixes the hit count: no hit count die to choose, one row without a choice that names the count and the ability', () => {
    if (!has(rules, 'abilities', 'skilllink')) return;
    play('skilllink');
    expect(kindsOf(offerOn('furyattack'))).toContain('hit-count');
    expect(offerOn('furyattack').some(offer => offer.fixedBy !== undefined)).toBe(false);
    const fixed = offerOn('furyattack', { ability: 'Skill Link' }).filter(offer => offer.name.kind === 'hit-count');
    expect(fixed).toEqual([{ name: { slot: 'p1a', moveId: 'furyattack', kind: 'hit-count' }, results: [{ hits: 5 }], fixedBy: dexOfRules(rules).abilities.get('skilllink').name }]);
  });

  test('a stalling die exists on the second use only', () => {
    const dex = dexOfRules(rules);
    const move = ['protect', 'detect'].find(id => dex.moves.get(id).exists && dex.moves.get(id).gen <= dex.gen);
    if (!move) return;
    play('stalling');
    const board = outfitBoard(rules, mode, { species: FAST, moves: [move] }, { species: 'Vaporeon' });
    expect(kindsOf(offeredDice(board, 'p1a', choice(move)))).not.toContain('stalling:stall');
    playClicks(board, sweepClicks(mode, 'self'));
    expect(kindsOf(offeredDice(board, 'p1a', choice(move)))).toContain('stalling:stall');
  });

  test('a move of 100 percent in Gen 2 offers no accuracy die, a move with an accuracy below 100 does', () => {
    if (rules.generation !== 2) return;
    play('gen2');
    expect(kindsOf(offerOn('scratch'))).not.toContain('accuracy');
    expect(kindsOf(offerOn('megakick'))).toContain('accuracy');
  });
});

describe('the offer rows played', () => {
  test.each(['kingsrock', 'abilities', 'skilllink', 'stalling', 'gen2'])('%s', row => {
    expect(played.get(row) ?? 0, row).toBeGreaterThan(0);
  });
});
