import { beforeAll, describe, expect, test } from 'vitest';
import { rolledCopy, type RolledCopy } from '../../packages/eval-engine/src/branch/rolled-copy';
import { evaluatePosition } from '../../packages/eval-engine/src/eval-function';
import { forkBattle } from '../../packages/eval-engine/src/forward/position';
import { ALIGNMENT_SEEDS, extractProtocolEvents, isPerfectAlignment, scoreAlignment } from '../../packages/eval-engine/src/hax-alignment';
import { rebuild, type FixtureId, type GameType, type Rebuilt } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B5 (T304): the copy of a turn with one die turned over. The report names the game's
 * biggest roll and asks what the other side of the die would have left; the copy plays the turn again from its start position with every
 * other die of the log as logged (the faint step and the phantom-proc rule of T306 included) and hands back the position of the next root.
 *
 * One row per game type, on the simulator: the turned die takes (a hit lands where the log has a miss, a miss where the log has a hit),
 * and the body that the log's turn did not knock out faints, or the one it did stays. Each scene also plays the control: the copy with no
 * die turned is the log's own turn (a perfect alignment), so the turned die alone makes the difference. The static score of the next
 * root stands in for the engine's evaluation here; `lanes/B/flip-cost.vt.ts` prices the real one.
 */

interface Scene {
  id: FixtureId;
  type: GameType;
  turn: number;
  /** The die turned over (`dieKey`). */
  flip: string;
  /** The move line of the die's user and the target the copy must show hit, or miss. */
  line: { user: string; move: string; target: string };
  lands: boolean;
  /** Where the copy stands after the turn: a knockout's replacement request, the next turn, or the end of the game. */
  stage: RolledCopy['stage'];
  /** Idents in the `|faint|` lines (`p1a: Corviknight`): faints the copy shows and the log's turn lacks, and the log's that the copy lacks. */
  gains: string[];
  loses: string[];
}

const SCENES: Scene[] = [
  { // singles: Garchomp's 95 % Fire Fang missed Corviknight, which then killed it with Body Press
    id: 'smogtours-gen8ou-573756', type: 'singles', turn: 73, flip: 'p2a:firefang:p1a:accuracy',
    line: { user: 'p2a', move: 'Fire Fang', target: 'p1a' }, lands: true, stage: 'request', gains: ['p1a: Corviknight'], loses: ['p2a: Penal Battalion'],
  },
  { // singles: Tapu Bulu's 80 % Stone Edge missed Ikki
    id: 'smogtours-gen8ou-562428', type: 'singles', turn: 11, flip: 'p1a:stoneedge:p2a:accuracy',
    line: { user: 'p1a', move: 'Stone Edge', target: 'p2a' }, lands: true, stage: 'request', gains: ['p2a: Ikki'], loses: [],
  },
  { // Doubles OU: Chi-Yu's Heat Wave missed Incineroar (the spread move hit the partner)
    id: 'smogtours-gen9doublesou-912045', type: 'doubles', turn: 5, flip: 'p2a:heatwave:p1a:accuracy',
    line: { user: 'p2a', move: 'Heat Wave', target: 'p1a' }, lands: true, stage: 'request', gains: [], loses: [],
  },
  { // Doubles OU, the other way: Okidogi's 80 % Gunk Shot hit and knocked Volcarona out (the loser's roll, the largest of the game)
    id: 'smogtours-gen9doublesou-912045', type: 'doubles', turn: 5, flip: 'p2b:gunkshot:p1b:accuracy',
    line: { user: 'p2b', move: 'Gunk Shot', target: 'p1b' }, lands: false, stage: 'turn', gains: [], loses: ['p1b: Volcarona'],
  },
  { // VGC: Groudon's 85 % Precipice Blades missed Koraidon, which was at 66 % after Knock Off
    id: 'gen9vgc2026regi-2629703929', type: 'vgc', turn: 10, flip: 'p2a:precipiceblades:p1b:accuracy',
    line: { user: 'p2a', move: 'Precipice Blades', target: 'p1b' }, lands: true, stage: 'ended', gains: ['p1b: Koraidon'], loses: [],
  },
];

const faintsOf = (lines: readonly string[]): string[] => lines.flatMap(line => line.match(/^\|faint\|(.+)$/)?.[1] ?? []);

/** The lines of one move: from its `|move|` line to the next one (the damage, miss and faint lines of its hits). */
function moveLines(lines: readonly string[], scene: Scene): string[] {
  const start = lines.findIndex(line => line.startsWith(`|move|${scene.line.user}: `) && line.split('|')[3] === scene.line.move);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith('|move|'));
  return lines.slice(start, end < 0 ? undefined : end);
}

const rebuilt = new Map<FixtureId, Rebuilt>();
beforeAll(async () => {
  for (const scene of SCENES) if (!rebuilt.has(scene.id)) rebuilt.set(scene.id, await rebuild(scene.id));
}, 300_000);

/** The copy of the scene's turn: with its die turned over, or the control with none. */
const copyOf = (scene: Scene, turned = true): RolledCopy | null => {
  const built = rebuilt.get(scene.id)!;
  return rolledCopy({ position: built.positions.get(scene.turn)!, replayLog: built.replay.log, turn: scene.turn, ...(turned ? { flip: scene.flip } : {}) });
};

describe.each(SCENES)('the copy of $id turn $turn with $flip turned over ($type)', scene => {
  test('the control copy, no die turned, is the log\'s own turn', () => {
    const built = rebuilt.get(scene.id)!;
    const control = copyOf(scene, false);
    expect(control).not.toBeNull();
    const expected = extractProtocolEvents(built.logBlock(scene.turn));
    expect(isPerfectAlignment(scoreAlignment(expected, control!.events))).toBe(true);
  });

  test('the turned die takes: the hit lands where the log has a miss, the miss where the log has a hit', () => {
    const built = rebuilt.get(scene.id)!;
    const logged = moveLines(built.logBlock(scene.turn), scene);
    const copy = copyOf(scene);
    expect(copy).not.toBeNull();
    const shown = moveLines(copy!.log, scene);
    const targetName = (line: string) => line.split('|')[2];
    const missed = (lines: string[]) => lines.some(line => line.startsWith('|-miss|') && line.split('|')[3]?.startsWith(`${scene.line.target}:`));
    const damaged = (lines: string[]) => lines.some(line => /^\|-damage\|/.test(line) && targetName(line).startsWith(`${scene.line.target}:`));
    // the log shows the other side of the die
    expect(missed(logged)).toBe(scene.lands);
    expect(damaged(logged)).toBe(!scene.lands);
    expect(missed(shown)).toBe(!scene.lands);
    expect(damaged(shown)).toBe(scene.lands);
  });

  test('the faints follow the turned die, by the simulator', () => {
    const built = rebuilt.get(scene.id)!;
    const logFaints = faintsOf(built.logBlock(scene.turn));
    const copyFaints = faintsOf(rolledCopy({
      position: built.positions.get(scene.turn)!, replayLog: built.replay.log, turn: scene.turn, flip: scene.flip,
    })?.log ?? []);
    for (const ident of scene.gains) {
      expect(logFaints).not.toContain(ident);
      expect(copyFaints).toContain(ident);
    }
    for (const ident of scene.loses) {
      expect(logFaints).toContain(ident);
      expect(copyFaints).not.toContain(ident);
    }
  });

  test('the next root is a position the engine can read: where the copy stands follows the simulator', () => {
    const copy = copyOf(scene);
    expect(copy).not.toBeNull();
    expect(copy!.stage).toBe(scene.stage);
    const battle = forkBattle({ serialized: copy!.serialized }, ALIGNMENT_SEEDS[0]);
    expect(battle.ended).toBe(scene.stage === 'ended');
    if (scene.stage !== 'ended') expect(battle.turn).toBe(scene.stage === 'turn' ? scene.turn + 1 : scene.turn);
  });
});

describe('573756 turn 73: a hit leaves LordEnz ahead', () => {
  test('the copy\'s next root scores above the actual one, for the side that rolled (p2)', () => {
    const built = rebuilt.get('smogtours-gen8ou-573756')!;
    const copy = copyOf(SCENES[0])!;
    const score = (serialized: string): number => -evaluatePosition(forkBattle({ serialized }, ALIGNMENT_SEEDS[0]));
    const actual = score(built.positions.get(74)!);
    const hit = score(copy.serialized);
    expect(hit).toBeGreaterThan(actual);
    expect(hit).toBeGreaterThan(0);
  });
});

/**
 * Round 86 (B6): the report hands the copy the roll it named (the side that rolled, the move, the doubles click's target body and
 * attacker slot) and the copy finds the die in the log: the winner's accuracy die that came out as a miss, on that move and that body.
 */
describe('the roll the report names finds its die in the log', () => {
  const copyFor = (scene: Scene, roll: NonNullable<Parameters<typeof rolledCopy>[0]['roll']>): RolledCopy | null => {
    const built = rebuilt.get(scene.id)!;
    return rolledCopy({ position: built.positions.get(scene.turn)!, replayLog: built.replay.log, turn: scene.turn, roll });
  };

  test.each([
    ['573756 t73, singles: Fire Fang of p2', SCENES[0], { side: 'p2', move: 'Fire Fang' }],
    ['562428 t11, singles: Stone Edge of p1', SCENES[1], { side: 'p1', move: 'Stone Edge' }],
    ['912045 t5, Doubles OU: Heat Wave of p2a on Incineroar', SCENES[2], { side: 'p2', move: 'Heat Wave', target: 'Incineroar', slot: 0 }],
    ['2629703929 t10, VGC: Precipice Blades of p2a on Koraidon', SCENES[4], { side: 'p2', move: 'Precipice Blades', target: 'Koraidon', slot: 0 }],
  ] as const)('%s turns the same die over as its key does', (_name, scene, roll) => {
    const byRoll = copyFor(scene, roll);
    const byKey = copyOf(scene);
    expect(byRoll).not.toBeNull();
    expect(byRoll!.serialized).toBe(byKey!.serialized);
    expect(byRoll!.flip).toBe(scene.flip);
  });

  test('a copy that ends the game hands over the score of the end, from p1\'s view (2629703929 t10: p2 wins)', () => {
    const copy = copyFor(SCENES[4], { side: 'p2', move: 'Precipice Blades', target: 'Koraidon', slot: 0 });
    expect(copy!.stage).toBe('ended');
    expect(copy!.terminal).toBe(-1);
    expect(copyFor(SCENES[0], { side: 'p2', move: 'Fire Fang' })!.terminal).toBeNull();
  });

  test('no die, no copy: another move, another side, another target body, another slot, a hit instead of a miss', () => {
    expect(copyFor(SCENES[0], { side: 'p2', move: 'Thunder Fang' })).toBeNull();
    expect(copyFor(SCENES[0], { side: 'p1', move: 'Fire Fang' })).toBeNull();
    expect(copyFor(SCENES[2], { side: 'p2', move: 'Heat Wave', target: 'Volcarona', slot: 0 })).toBeNull();
    expect(copyFor(SCENES[2], { side: 'p2', move: 'Heat Wave', target: 'Incineroar', slot: 1 })).toBeNull();
    // Gunk Shot hit in the log: there is no miss to turn into a hit
    expect(copyFor(SCENES[3], { side: 'p2', move: 'Gunk Shot', target: 'Volcarona', slot: 1 })).toBeNull();
  });
});

describe('what the copy refuses', () => {
  test('a die the log does not name gives no copy (the sentence speaks only where the log names the event)', () => {
    const built = rebuilt.get('smogtours-gen8ou-573756')!;
    const none = rolledCopy({ position: built.positions.get(73)!, replayLog: built.replay.log, turn: 73, flip: 'p2a:thunderfang:p1a:accuracy' });
    expect(none).toBeNull();
  });

  test('a die that is no chance gives no copy (a damage roll or a tie has no other side)', () => {
    const built = rebuilt.get('smogtours-gen9doublesou-912045')!;
    const tie = rolledCopy({ position: built.positions.get(5)!, replayLog: built.replay.log, turn: 5, flip: 'p1b::p2a:speed-tie' });
    expect(tie).toBeNull();
  });

  test('a turn the log does not have gives no copy', () => {
    const built = rebuilt.get('smogtours-gen8ou-573756')!;
    expect(rolledCopy({ position: built.positions.get(73)!, replayLog: built.replay.log, turn: 500, flip: 'p2a:firefang:p1a:accuracy' })).toBeNull();
  });
});
