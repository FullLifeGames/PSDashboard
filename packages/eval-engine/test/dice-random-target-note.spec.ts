import { toID } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { AIM_FREE_TARGETS, sampleDecides } from '../src/dice/aim';
import { dieKey, type DieName, type Draw, type ForcedDie } from '../src/dice/types';
import { playLikeliestTurn } from '../src/dice/likeliest';
import { playClicks, standing, sweepSelection, SWEEPS_FULL, type Mode, type Rules } from './dice-fixtures';
import { clicksAccepted, dexOfRules, forcedOn, isCharge, isDelayed, SWEEP_CASES, sweepMoves, VGC_RULES, type DexMove } from './dice-sweep-support';
import { bentScene, ofKind, pickBoard, pickClicks, publicHalf, recorded } from './dice-pick-support';

// Round 89 (X1a, ruling 39): the note "The click cannot force random targets. The seed decides them." stood under nearly every doubles
// line. The simulator samples a foe for every click that names no target (`getRandomTarget`), and a spread move such as Earthquake or a
// field move such as Spikes gets one too, but `getMoveTargets` ignores it: the sample cannot change the turn, and the note was false.
// For every rule set with doubles (Gens 3 to 9 and Champions), doubles and VGC, every Dex move that reaches the sweep: the user's click
// that names no target (a spread or field move clicked plain) and the click an Encore bends (any move), the die of the user's move forced
// to each standing foe. A move whose two plays show the same log (the target field of the `|move|` line aside) and the same bodies is a
// move whose sample changes nothing; the Dex targets of such moves must be exactly `AIM_FREE_TARGETS`, the rule the line's note reads.
await loadSimMods('gen9championsou');

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = [
  ...SWEEP_CASES.filter(entry => entry.mode === 'doubles').map(entry => ({ ...entry, vgc: false })),
  ...VGC_RULES.map(rules => ({ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` })),
];
const FOES = ['p2a', 'p2b'];
const pick = (moveId: string): DieName => ({ slot: 'p1a', moveId, kind: 'random-target' });

/** A log without its clock, and without the target field of the user's `|move|` lines (a spread move names the body that was sampled). */
const effects = (lines: readonly string[]): string =>
  publicHalf(lines).filter(line => !line.startsWith('|t:|')).map(line => {
    if (!line.startsWith('|move|')) return line;
    const fields = line.split('|');
    return [...fields.slice(0, 4), ...fields.slice(5)].join('|');
  }).join('\n');

/** What a sample can do to one scene: undefined where the scene draws no random target; else whether the two foes' plays differ. */
function sampleChanges(board: Parameters<typeof forcedOn>[0], clicks: { p1: string; p2: string }, moveId: string): boolean | undefined {
  const turn = recorded(board, clicks);
  const key = dieKey(pick(moveId));
  if (!ofKind(turn, 'random-target').some(([entry]) => entry === key)) return undefined;
  const before = standing(board);
  const plays = FOES.map(foe => {
    const forced: ForcedDie = { name: pick(moveId), result: { option: foe } };
    const { battle, start } = forcedOn(board, clicks, [forced]);
    return `${effects(battle.log.slice(start))}\n${standing(battle)}`;
  });
  expect(standing(board), 'the question leaves the battle as it was').toBe(before);
  return plays[0] !== plays[1];
}

/** The first three damaging moves and the first status move of every Dex target (so the plain run meets each target, and a move that aims shows it) and the sample every sweep plays. */
function chosen(moves: readonly DexMove[]): DexMove[] {
  const first = new Map<string, DexMove[]>();
  for (const move of moves) {
    const held = first.get(move.target) ?? [];
    if (move.category === 'Status' ? held.every(entry => entry.category !== 'Status') : held.filter(entry => entry.category !== 'Status').length < 3) first.set(move.target, [...held, move]);
  }
  return [...new Set([...[...first.values()].flat(), ...sweepSelection(moves, 'moves')])];
}

type Scene = { board: Parameters<typeof forcedOn>[0]; clicks: { p1: string; p2: string } };

/** The scenes of a move: its own click with no target, the click an Encore bends, and for a scripted move one where a foe's attack hits the user first. */
function scenesOf(input: { rules: Rules; mode: Mode; vgc: boolean }, move: DexMove): Scene[] {
  const { rules, mode, vgc } = input;
  const scenes: Scene[] = [];
  for (const aim of ['move 1', 'move 1 1']) {
    const board = pickBoard({ rules, mode, vgc, attacker: [move.id] });
    const clicks = pickClicks(mode, aim);
    if (clicksAccepted(board, clicks)) { scenes.push({ board, clicks }); break; }
  }
  for (const aim of ['move 1', 'move 1 1']) {
    const bent = bentScene(input, move.id, aim);
    if (bent) { scenes.push(bent); break; }
  }
  if (move.target === 'scripted') {
    // the faster foe hits the user before the scripted move: a physical hit and a special hit (the moves of every generation)
    for (const attack of ['tackle', 'watergun']) {
      const board = pickBoard({ rules, mode, vgc, attacker: [move.id], foe: [attack, 'splash'] });
      const clicks = pickClicks(mode, 'move 1', 'move 1 1');
      if (clicksAccepted(board, clicks)) scenes.push({ board, clicks });
    }
  }
  return scenes;
}

describe('what the simulator does with a sampled random target: the Dex targets that ignore it are the rule', () => {
  test.each(CASES)('the targets in $name', ({ rules, mode, vgc }) => {
    const dex = dexOfRules(rules);
    const { moves } = sweepMoves(rules, move => !isCharge(move) && !isDelayed(move), false, true);
    const drawn = new Map<string, { moves: number; damaging: number; differing: string[]; same: string[] }>();
    for (const move of chosen(moves)) {
      const scenes = scenesOf({ rules, mode, vgc }, move);
      for (const scene of scenes) {
        const changes = sampleChanges(scene.board, scene.clicks, move.id);
        if (changes === undefined) continue;
        const entry = drawn.get(move.target) ?? { moves: 0, damaging: 0, differing: [], same: [] };
        entry.moves++;
        if (move.category !== 'Status') entry.damaging++;
        (changes ? entry.differing : entry.same).push(move.id);
        drawn.set(move.target, entry);
      }
    }
    const problems: string[] = [];
    for (const [target, entry] of drawn) {
      if (AIM_FREE_TARGETS.has(target) && entry.differing.length > 0) problems.push(`${target}: the sample changed the turn of ${entry.differing.join(', ')}, the rule says it cannot`);
      // a target whose drawn moves are all status moves with no effect on a foe in these scenes (Me First, Doodle) has no row to prove: it takes the simulator's default branch of `getMoveTargets`, as `normal` does
      if (!AIM_FREE_TARGETS.has(target) && entry.damaging > 0 && entry.differing.length === 0) problems.push(`${target}: no move of ${entry.same.join(', ')} changed with its sample, the rule says it does`);
    }
    expect(problems).toEqual([]);
    // the sweep meets both kinds of target: a spread move (its sample changes nothing) and a move that aims
    const spread = ['allAdjacentFoes', 'allAdjacent'].filter(target => dex.moves.all().some(move => move.exists && move.target === target));
    expect(spread.some(target => drawn.get(target)?.same.length), 'a spread move with a drawn target').toBeTruthy();
    expect([...drawn].some(([target, entry]) => !AIM_FREE_TARGETS.has(target) && entry.differing.length > 0), 'a move whose sample matters').toBe(true);
    if (SWEEPS_FULL) expect([...drawn.values()].reduce((sum, entry) => sum + entry.moves, 0)).toBeGreaterThan(20);
  });

  test('every Dex target is classed: a target the simulator adds shows up here first', () => {
    const known = new Set([...AIM_FREE_TARGETS, 'normal', 'any', 'adjacentFoe', 'randomNormal', 'scripted', 'adjacentAlly', 'adjacentAllyOrSelf', 'self']);
    const unknown = new Set<string>();
    for (const { rules } of CASES) for (const move of dexOfRules(rules).moves.all()) if (move.exists && !known.has(move.target)) unknown.add(move.target);
    expect([...unknown]).toEqual([]);
  });
});

describe('a scripted move answers the body that hit it, whichever foe the sample names', () => {
  test.each(CASES)('Counter and Mirror Coat in $name', ({ rules, mode, vgc }) => {
    const dex = dexOfRules(rules);
    for (const [id, attack] of [['counter', 'tackle'], ['mirrorcoat', 'watergun']] as const) {
      const move = dex.moves.get(id);
      if (!move.exists || move.gen > dex.gen) continue;
      const board = pickBoard({ rules, mode, vgc, attacker: [id], foe: [attack, 'splash'] });
      const clicks = pickClicks(mode, 'move 1', 'move 1 1');
      expect(clicksAccepted(board, clicks), `${id}: the click plays`).toBe(true);
      const plays = FOES.map(foe => {
        const forced: ForcedDie = { name: pick(id), result: { option: foe } };
        const { battle, start } = forcedOn(board, clicks, [forced]);
        return effects(battle.log.slice(start));
      });
      expect(plays[0], `${id}: the same turn whichever foe the sample names`).toBe(plays[1]);
      const lines = plays[0].split('\n');
      const answered = lines.findIndex(line => line.startsWith('|move|p1a') && toID(line.split('|')[3]) === id);
      expect(answered, `${id}: the user's move is in the log`).toBeGreaterThan(-1);
      expect(lines.slice(answered).some(line => line.startsWith('|-damage|p2a')), `${id}: the move hurts the foe that hit the user`).toBe(true);
    }
  });
});

describe('the scene rows: which line carries the note', () => {
  const hit = (target: string, items: unknown[]): [string, Draw] => [target, { call: 'sample', items }];

  test('a sample over one body, a spread move and a field move cannot change the turn; a move that aims over two foes can', () => {
    expect(sampleDecides('normal', { call: 'sample', items: ['p2a', 'p2b'] })).toBe(true);
    expect(sampleDecides('randomNormal', { call: 'sample', items: ['p2a', 'p2b'] })).toBe(true);
    expect(sampleDecides('normal', { call: 'sample', items: ['p2b'] })).toBe(false);
    for (const [target, draw] of [hit('allAdjacent', ['p2a', 'p2b']), hit('allAdjacentFoes', ['p2a', 'p2b']), hit('foeSide', ['p2a', 'p2b'])]) expect(sampleDecides(target, draw)).toBe(false);
    // a draw that is no sample reads as one that can matter
    expect(sampleDecides('normal', undefined)).toBe(true);
  });

  const SCENES: { id: string; carries: boolean }[] = [{ id: 'earthquake', carries: false }, { id: 'thrash', carries: true }];
  test.each(CASES.flatMap(entry => SCENES.map(scene => ({ ...entry, ...scene }))))('$id plain in $name: the line says the seed decides the target only for $carries', ({ rules, mode, vgc, id, carries }) => {
    const move = dexOfRules(rules).moves.get(id);
    if (!move.exists || move.gen > dexOfRules(rules).gen) return;
    const board = pickBoard({ rules, mode, vgc, attacker: [id] });
    const clicks = pickClicks(mode, 'move 1');
    if (!clicksAccepted(board, clicks)) return;
    const turn = playLikeliestTurn(board, battle => playClicks(battle, clicks));
    expect(turn.unforced.includes('random-target')).toBe(carries);
  });

  test.each(CASES)('a click an Encore bent onto a one-target move keeps the note: $name', ({ rules, mode, vgc }) => {
    const encore = dexOfRules(rules).moves.get('encore');
    if (!encore.exists || encore.gen > dexOfRules(rules).gen) return;
    const scene = bentScene({ rules, mode, vgc }, 'tackle', 'move 1 1');
    expect(scene, 'the scene plays').not.toBeNull();
    const turn = playLikeliestTurn(scene!.board, battle => playClicks(battle, scene!.clicks));
    expect(turn.unforced).toContain('random-target');
  });
});
