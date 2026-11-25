import { toID } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { AIM_FREE_TARGETS, sampleDecides } from '../src/dice/aim';
import { dieKey, type DieName, type Draw, type ForcedDie } from '../src/dice/types';
import { playLikeliestTurn } from '../src/dice/likeliest';
import { playClicks, standing, sweepSelection, SWEEPS_FULL, type Mode, type Rules } from './dice-fixtures';
import { clicksAccepted, dexOfRules, forcedOn, isCharge, isDelayed, SWEEP_CASES, sweepMoves, VGC_RULES, type DexMove } from './dice-sweep-support';
import { bentScene, ofKind, pickBoard, pickClicks, publicHalf, recorded } from './dice-pick-support';

await loadSimMods('gen9championsou');

const CASES: { rules: Rules; mode: Mode; vgc: boolean; name: string }[] = [
  ...SWEEP_CASES.filter(entry => entry.mode === 'doubles').map(entry => ({ ...entry, vgc: false })),
  ...VGC_RULES.map(rules => ({ rules, mode: 'doubles' as const, vgc: true, name: `${rules.name} VGC` })),
];
const FOES = ['p2a', 'p2b'];
const pick = (moveId: string): DieName => ({ slot: 'p1a', moveId, kind: 'random-target' });

const effects = (lines: readonly string[]): string =>
  publicHalf(lines).filter(line => !line.startsWith('|t:|')).map(line => {
    if (!line.startsWith('|move|')) return line;
    const fields = line.split('|');
    return [...fields.slice(0, 4), ...fields.slice(5)].join('|');
  }).join('\n');

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

function chosen(moves: readonly DexMove[]): DexMove[] {
  const first = new Map<string, DexMove[]>();
  for (const move of moves) {
    const held = first.get(move.target) ?? [];
    if (move.category === 'Status' ? held.every(entry => entry.category !== 'Status') : held.filter(entry => entry.category !== 'Status').length < 3) first.set(move.target, [...held, move]);
  }
  return [...new Set([...[...first.values()].flat(), ...sweepSelection(moves, 'moves')])];
}

type Scene = { board: Parameters<typeof forcedOn>[0]; clicks: { p1: string; p2: string } };

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
      if (!AIM_FREE_TARGETS.has(target) && entry.damaging > 0 && entry.differing.length === 0) problems.push(`${target}: no move of ${entry.same.join(', ')} changed with its sample, the rule says it does`);
    }
    expect(problems).toEqual([]);
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

const WRITES_TARGET = /\bmove\.target\s*=[^=]/;

function writersOf(rules: Rules): string[] {
  const dex = dexOfRules(rules);
  const entries: [string, object][] = [
    ...dex.moves.all().filter(entry => entry.exists).map(entry => [`move ${entry.id}`, entry] as [string, object]),
    ...dex.abilities.all().filter(entry => entry.exists).map(entry => [`ability ${entry.id}`, entry] as [string, object]),
    ...dex.items.all().filter(entry => entry.exists).map(entry => [`item ${entry.id}`, entry] as [string, object]),
    ...Object.entries(dex.data.Conditions ?? {}).map(([id, entry]) => [`condition ${id}`, entry as object] as [string, object]),
  ];
  const found = new Set<string>();
  for (const [name, entry] of entries) {
    const holders = [entry, (entry as { condition?: object }).condition ?? {}];
    if (holders.some(holder => Object.values(holder).some(value => typeof value === 'function' && WRITES_TARGET.test(String(value))))) found.add(name);
  }
  return [...found].sort();
}

const VARIANTS = [
  { name: 'a plain user', species: 'Snorlax', terrain: false },
  { name: 'a Ghost user', species: 'Gengar', terrain: false },
  { name: 'Terapagos-Stellar', species: 'Terapagos-Stellar', terrain: false },
  { name: 'a grounded user on Psychic Terrain', species: 'Snorlax', terrain: true },
];

function variantScene(input: { rules: Rules; mode: Mode; vgc: boolean }, moveId: string, variant: typeof VARIANTS[number]): Scene[] {
  const { rules, mode, vgc } = input;
  const dex = dexOfRules(rules);
  if (!dex.species.get(variant.species).exists || dex.species.get(variant.species).gen > dex.gen) return [];
  const scenes: Scene[] = [];
  for (const aim of ['move 1', 'move 1 1']) {
    const board = pickBoard({ rules, mode, vgc, attacker: variant.terrain ? [moveId, 'psychicterrain'] : [moveId], attackerSpecies: variant.species });
    if (variant.terrain) {
      const opening = pickClicks(mode, 'move 2');
      if (!clicksAccepted(board, opening)) return [];
      playClicks(board, opening);
    }
    const clicks = pickClicks(mode, aim);
    if (clicksAccepted(board, clicks)) { scenes.push({ board, clicks }); break; }
  }
  if (!variant.terrain) {
    for (const aim of ['move 1', 'move 1 1']) {
      const bent = bentScene({ rules, mode, vgc, attackerSpecies: variant.species }, moveId, aim);
      if (bent) { scenes.push(bent); break; }
    }
  }
  return scenes;
}

describe('a move whose handlers change its own target: the note shows exactly when the sample changes the turn', () => {
  const TRIGGERS = new Set(['move curse', 'move expandingforce', 'move terastarstorm']);

  test.each(CASES)('the writers and their scenes in $name', ({ rules, mode, vgc }) => {
    const dex = dexOfRules(rules);
    const writers = writersOf(rules).filter(name => !name.startsWith('move ') || dex.moves.get(name.slice(5)).gen <= dex.gen);
    expect(writers.filter(name => !TRIGGERS.has(name)), 'a handler that writes a target needs a user in VARIANTS').toEqual([]);
    const problems: string[] = [];
    let played = 0;
    let shown = 0;
    for (const name of writers) {
      const moveId = name.slice(5);
      for (const variant of VARIANTS) {
        for (const scene of variantScene({ rules, mode, vgc }, moveId, variant)) {
          const changes = sampleChanges(scene.board, scene.clicks, moveId);
          if (changes === undefined) continue;
          played++;
          const turn = playLikeliestTurn(scene.board, battle => playClicks(battle, scene.clicks));
          if (turn.unforced.includes('random-target')) shown++;
          if (turn.unforced.includes('random-target') !== changes) problems.push(`${moveId} by ${variant.name}: the sample ${changes ? 'changes' : 'cannot change'} the turn, the note ${changes ? 'is missing' : 'shows'}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(played, 'the scenes of a writer are drawn').toBeGreaterThan(0);
    expect(shown, 'a writer that aims at one body keeps the note').toBeGreaterThan(0);
  });

  test.each(SWEEP_CASES.filter(entry => entry.mode === 'singles'))('a singles click draws no random target for any of them: $name', ({ rules }) => {
    for (const name of writersOf(rules).filter(entry => entry.startsWith('move '))) {
      for (const variant of VARIANTS) {
        for (const scene of variantScene({ rules, mode: 'singles', vgc: false }, name.slice(5), variant)) {
          const turn = playLikeliestTurn(scene.board, battle => playClicks(battle, scene.clicks));
          expect(turn.unforced, `${name} by ${variant.name}`).not.toContain('random-target');
        }
      }
    }
  });
});
