import { describe, expect, test } from 'vitest';
import { PRNG, type PokemonSet } from '@pkmn/sim';
import { rulesDex, toId } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import type { ForcedDie } from '../src/dice/types';
import { branchOf, clickWith, mon, runTurn, turnLines, type Commands, type SlotChoices } from './branch-dice-support';
import { playTurn, reconstruct } from './arrival-turn';

/**
 * Round 82 (forced dice), criterion 2: an action the user leaves alone keeps its dice when another action's die is forced. The
 * first turn of a branch plays the log's dice for it (`logged-rolls.spec.ts`, round 73), a later turn the natural turn's. Each
 * scene plays the turn twice from the same position through `executeBranchChoices`: as the app plays it today, and with the
 * crit of one action flipped to the other answer. Every other action's lines (its hit, crit, damage roll, secondary effects)
 * stay what they were. Singles, doubles and VGC; the first turn and the turn after it.
 */
await loadSimMods('gen9championsou');

/** Turns whose arrival plays the log perfectly (`isPerfectAlignment`): the unforced turn is the log's turn, so it is the baseline. */
interface Scene { label: string; fixture: string; turn: number }
const SCENES: Scene[] = [
  { label: 'singles (GPL DzBQ5azlO5l t13)', fixture: 'gpl-replay', turn: 13 },
  { label: 'doubles (gen9doublesou-2694811367 t4)', fixture: 'gen9doublesou-2694811367', turn: 4 },
  { label: 'VGC (gen9vgc2026regi-2630181744 t4)', fixture: 'gen9vgc2026regi-2630181744', turn: 4 },
];

const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24'];
const parts = (line: string) => line.split('|');
const identSlot = (ident: string | undefined) => /^(p[12][a-d])/.exec(ident ?? '')?.[1] ?? '';
const queuedMove = (line: string) => parts(line)[1] === 'move' && !line.includes('|[from]');

/** The lines of each queued action, cut at the next action and at the first blank line (residuals and request breaks stay out). */
function actionBlocks(lines: string[]): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  let key: string | null = null;
  for (const line of lines.filter(entry => !entry.startsWith('|t:|') && !entry.startsWith('|split|'))) {
    if (queuedMove(line)) {
      key = `${identSlot(parts(line)[2])}:${toId(parts(line)[3])}`;
      blocks.set(key, [line]);
    } else if (line === '|' || line.startsWith('|upkeep') || line.startsWith('|turn|')) {
      key = null;
    } else if (key) {
      blocks.get(key)!.push(line);
    }
  }
  return blocks;
}

/** The targets of a queued move line: the aimed one and the `[spread]` list. */
function aimsOf(line: string): string[] {
  const spread = parts(line).find(part => part.startsWith('[spread]'))?.slice('[spread]'.length).trim().split(',').filter(Boolean) ?? [];
  return [...new Set([identSlot(parts(line)[4]), ...spread].filter(Boolean))];
}

/**
 * The die to force: the crit (or the accuracy) of the first damaging action whose target no later action aims at, flipped to the
 * answer the unforced turn did not give. A forced crit leaves the number of draws as it was; a forced miss on a hit removes the
 * crit and the damage roll, a forced hit on a miss adds them, so only the accuracy moves every later draw of a plain stream.
 */
function flippedDie(lines: string[], kind: 'crit' | 'accuracy'): { die: ForcedDie; moveId: string } | null {
  const moves = lines.filter(queuedMove);
  for (const [index, line] of moves.entries()) {
    const [target] = aimsOf(line);
    const slot = identSlot(parts(line)[2]);
    // an action after this one on the same target would show the changed hit points in its own damage line
    if (!target || moves.slice(index + 1).some(later => aimsOf(later).includes(target))) continue;
    const dexMove = rulesDex(9).moves.get(toId(parts(line)[3]));
    // a move of fixed damage, of a set power or that always crits draws no crit; a move that cannot miss draws no accuracy
    if (dexMove.basePower === 0 || dexMove.damage || dexMove.ohko || dexMove.damageCallback) continue;
    if (kind === 'crit' && dexMove.willCrit) continue;
    if (kind === 'accuracy' && (dexMove.accuracy === true || dexMove.accuracy >= 100)) continue;
    const key = `${slot}:${toId(parts(line)[3])}`;
    const block = actionBlocks(lines).get(key) ?? [];
    const hit = block.some(entry => entry.startsWith(`|-damage|${target}`));
    const missed = block.some(entry => entry.startsWith('|-miss|')) || line.includes('[miss]');
    if (!hit && !missed) continue;
    const moveId = toId(parts(line)[3]);
    const happens = kind === 'crit' ? !block.some(entry => entry.startsWith('|-crit|')) : missed;
    return { moveId, die: { name: { slot, moveId, targetSlot: target, kind }, result: { happens } } };
  }
  return null;
}

const choicesWith = (flip: { die: ForcedDie; moveId: string }): SlotChoices => {
  const side = flip.die.name.slot.startsWith('p1') ? 'p1' : 'p2';
  const index = 'abcd'.indexOf(flip.die.name.slot[2]);
  const mine = Array.from({ length: index + 1 }, (_, at) => (at === index ? clickWith(flip.moveId, [flip.die]) : null));
  return side === 'p1' ? { p1: mine, p2: [] } : { p1: [], p2: mine };
};

function expectOthersKept(unforced: string[], forced: string[], key: string, label: string): number {
  const before = actionBlocks(unforced);
  const after = actionBlocks(forced);
  let compared = 0;
  for (const [other, lines] of before) {
    if (other === key || !after.has(other)) continue;
    expect(after.get(other), `${label}: ${other}`).toEqual(lines);
    compared += 1;
  }
  return compared;
}

const missIn = (lines: string[], key: string): boolean => (actionBlocks(lines).get(key) ?? []).some(line => line.startsWith('|-miss|')) || (actionBlocks(lines).get(key) ?? [])[0]?.includes('[miss]') === true;
const critIn = (lines: string[], key: string): boolean => (actionBlocks(lines).get(key) ?? []).some(line => line.startsWith('|-crit|'));

describe.each(SCENES)('an action left alone keeps its dice, $label', scene => {
  test('the first turn: the log\'s dice of every other action stay', { timeout: 300000 }, async () => {
    const plain = await reconstruct(scene.fixture, scene.turn);
    const unforced = await playTurn(plain.runtime, plain.replay.log, scene.turn);
    const flip = flippedDie(unforced.lines, 'crit');
    expect(flip, 'a damaging action to flip').not.toBeNull();
    const asked = await reconstruct(scene.fixture, scene.turn);
    const forced = await playTurn(asked.runtime, asked.replay.log, scene.turn, undefined, choicesWith(flip!));
    expect(forced.report?.forced.map(entry => entry.took)).toEqual(['applied']);
    const key = `${flip!.die.name.slot}:${flip!.moveId}`;
    expect(critIn(forced.lines, key)).toBe(flip!.die.result.happens);
    expect(expectOthersKept(unforced.lines, forced.lines, key, 'first turn')).toBeGreaterThan(0);
  });
});

interface Board { label: string; format: string; p1: PokemonSet[]; p2: PokemonSet[]; commands: Commands }
const bench = (names: string[]) => names.map(species => mon(species, ['splash']));
const BOARDS: Board[] = [
  {
    label: 'singles', format: 'gen9customgame',
    p1: [mon('Blissey', ['smog']), mon('Chansey', ['splash'])], p2: [mon('Snorlax', ['smog'])],
    commands: [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }],
  },
  {
    label: 'doubles', format: 'gen9doublescustomgame',
    p1: [mon('Blissey', ['smog']), mon('Chansey', ['smog'])], p2: [mon('Snorlax', ['smog']), mon('Snorlax', ['smog'])],
    commands: [{ side: 'p1', command: 'move 1 1, move 1 2' }, { side: 'p2', command: 'move 1 1, move 1 2' }],
  },
  {
    label: 'VGC (a team of six)', format: 'gen9doublescustomgame',
    p1: [mon('Blissey', ['smog']), mon('Chansey', ['smog']), ...bench(['Eevee', 'Pikachu', 'Snorlax', 'Vaporeon'])],
    p2: [mon('Snorlax', ['smog']), mon('Snorlax', ['smog']), ...bench(['Eevee', 'Pikachu', 'Blissey', 'Vaporeon'])],
    commands: [{ side: 'p1', command: 'move 1 1, move 1 2' }, { side: 'p2', command: 'move 1 1, move 1 2' }],
  },
];

describe.each(BOARDS)('an action left alone keeps its dice on a later turn, $label', board => {
  // a later turn draws from the plain stream: any seed is a natural turn, and the check needs one where more than one action runs
  const play = async (seed: string, flip: { die: ForcedDie; moveId: string } | null) => {
    const runtime = await branchOf(board.format, board.p1, board.p2, '1,2,3,4');
    const first = await runTurn(runtime, board.commands, null);
    expect(first.ok, 'the first turn').toBe(true);
    const battle = runtime.battleStream.battle!;
    expect(battle.turn).toBe(2);
    battle.prng = new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
    const start = battle.log.length;
    const result = await runTurn(runtime, board.commands, flip ? choicesWith(flip) : null);
    return { result, lines: turnLines(runtime, start) };
  };

  test('the natural dice of every other action stay', { timeout: 120000 }, async () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const unforced = await play(seed, null);
      expect(unforced.result.ok, seed).toBe(true);
      const flip = flippedDie(unforced.lines, 'accuracy');
      expect(flip, seed).not.toBeNull();
      const forced = await play(seed, flip);
      expect(forced.result.ok, seed).toBe(true);
      expect(forced.result.ok ? forced.result.dice?.forced.map(entry => entry.took) : null, seed).toEqual(['applied']);
      const key = `${flip!.die.name.slot}:${flip!.moveId}`;
      expect(missIn(forced.lines, key), seed).toBe(!flip!.die.result.happens);
      checked += expectOthersKept(unforced.lines, forced.lines, key, `${board.label}, seed ${seed}`);
    }
    expect(checked).toBeGreaterThanOrEqual(SEEDS.length);
  });
});
