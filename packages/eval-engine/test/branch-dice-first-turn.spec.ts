import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { LoggedRollPRNG } from '../src/branch/logged-rolls';
import { loggedTurnDice, turnChanges, userDice } from '../src/dice/turn';
import { dieKey, type DieReport } from '../src/dice/types';
import { branchOf, clickWith, mon } from './branch-dice-support';
import { executeBranchChoices } from '../src/branch-engine';
import { playTurn, reconstruct } from './arrival-turn';

/**
 * Round 82 (forced dice), step A6, item 2 (gate answer 19a): on the first turn of a branch the dice the log shows for the actions
 * the user leaves as logged join the user's dice, once the user forces a die in that turn. The slots whose action the user
 * changed (another move, another aim, a switch) leave the join, as do the dice aimed at a body the user switched out.
 */
await loadSimMods('gen9championsou');

const feedback = (name: string): ReplayData =>
  JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

const cmd = (side: 'p1' | 'p2', command: string) => ({ side, command });

describe('turnChanges: the slots the user acts differently in than the log', () => {
  test('singles: the same move is no change, another move or a switch is, a switch also names the body that leaves', () => {
    const logged = { p1: 'move 2', p2: 'move 1' };
    expect(turnChanges(logged, [cmd('p1', 'move 2'), cmd('p2', 'move 1')])).toEqual({ changed: new Set(), switched: new Set() });
    expect(turnChanges(logged, [cmd('p1', 'move 3'), cmd('p2', 'move 1')])).toEqual({ changed: new Set(['p1a']), switched: new Set() });
    expect(turnChanges(logged, [cmd('p1', 'move 2'), cmd('p2', 'switch 3')])).toEqual({ changed: new Set(['p2a']), switched: new Set(['p2a']) });
    // a modifier (Terastallize) leaves the action as it was: the dice are named by slot, move and target
    expect(turnChanges(logged, [cmd('p1', 'move 2 terastallize'), cmd('p2', 'move 1')]).changed.size).toBe(0);
  });

  test('doubles: each slot on its own, and another aim is a change', () => {
    const logged = { p1: 'move 1 1, move 2 -2', p2: 'move 3 2, switch 4' };
    expect(turnChanges(logged, [cmd('p1', 'move 1 1, move 2 -2'), cmd('p2', 'move 3 2, switch 4')]).changed.size).toBe(0);
    expect(turnChanges(logged, [cmd('p1', 'move 1 2, move 2 -2'), cmd('p2', 'move 3 2, switch 4')])).toEqual({ changed: new Set(['p1a']), switched: new Set() });
    expect(turnChanges(logged, [cmd('p1', 'move 1 1, move 2 -2'), cmd('p2', 'move 3 2, switch 3')])).toEqual({ changed: new Set(['p2b']), switched: new Set(['p2b']) });
    // a spread move writes no aim on one side: no change
    expect(turnChanges({ p1: 'move 1, move 2', p2: 'move 1 1, move 1' }, [cmd('p1', 'move 1 1, move 2'), cmd('p2', 'move 1 1, move 1')]).changed.size).toBe(0);
    // only the sides that send a command are compared (a forced replacement of one side)
    expect(turnChanges(logged, [cmd('p2', 'switch 3, pass')]).changed).toEqual(new Set(['p2a', 'p2b']));
  });

  test('userDice reads both sides in slot order and keeps the first of two dice with one key', () => {
    const die = (slot: string, happens: boolean) => ({ name: { slot, moveId: 'tackle', targetSlot: 'p2a', kind: 'accuracy' as const }, result: { happens } });
    const dice = userDice([clickWith('tackle', [die('p1a', true)]), null], [clickWith('tackle', [die('p2a', false), die('p1a', false)])]);
    expect(dice.map(entry => [dieKey(entry.name), 'happens' in entry.result && entry.result.happens])).toEqual([
      ['p1a:tackle:p2a:accuracy', true], ['p2a:tackle:p2a:accuracy', false],
    ]);
    expect(userDice([clickWith('tackle'), null], [])).toEqual([]);
  });
});

const tookOf = (report: { forced: DieReport[] } | undefined, slot: string, kind: string) =>
  report?.forced.find(entry => entry.die.name.slot === slot && entry.die.name.kind === kind)?.took;
const has = (lines: string[], prefix: string): boolean => lines.some(line => line.startsWith(prefix));

describe('the first turn through executeBranchChoices joins the log\'s dice to the user\'s', () => {
  const FIRE_FANG = { fixture: 'smogtours-gen8ou-573756', source: feedback('smogtours-gen8ou-573756'), turn: 73 };
  const DOUBLES = { fixture: 'gen9doublesou-2663093831', source: feedback('gen9doublesou-2663093831'), turn: 8 };

  test('the branch\'s first-turn PRNG knows the logged turn it opened on', { timeout: 300000 }, async () => {
    const { runtime } = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    const prng = runtime.battleStream.battle!.prng;
    expect(prng).toBeInstanceOf(LoggedRollPRNG);
    const logged = (prng as LoggedRollPRNG).loggedTurn!;
    expect(logged.turn).toBe(FIRE_FANG.turn);
    expect(logged.lines.some(line => line.startsWith('|move|p2a: Penal Battalion|Fire Fang|'))).toBe(true);
    expect(logged.choices.p1).toMatch(/^move \d/);
  });

  test('loggedTurnDice names what the log shows for the position, for the chips of the panel; a position without a logged turn shows none', { timeout: 300000 }, async () => {
    const { runtime } = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    const dice = loggedTurnDice(runtime.battleStream.battle!);
    const fangMiss = dice.find(die => die.name.slot === 'p2a' && die.name.moveId === 'firefang' && die.name.kind === 'accuracy');
    expect(fangMiss?.result).toEqual({ happens: false });
    expect(dice.some(die => die.name.slot === 'p1a' && die.name.moveId === 'bodypress' && die.name.kind === 'accuracy')).toBe(true);
    const plain = await branchOf('gen9customgame', [mon('Pikachu', ['tackle'])], [mon('Snorlax', ['tackle'])], '1,2,3,4');
    expect(loggedTurnDice(plain.battleStream.battle!)).toEqual([]);
  });

  test('singles (smogtours-gen8ou-573756 t73): forcing the crit of Body Press keeps the Fire Fang miss of the log', { timeout: 300000 }, async () => {
    const crit = { name: { slot: 'p1a', moveId: 'bodypress', targetSlot: 'p2a', kind: 'crit' as const }, result: { happens: true } };
    const { replay, runtime } = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    const played = await playTurn(runtime, replay.log, FIRE_FANG.turn, undefined, { p1: [clickWith('bodypress', [crit])], p2: [] });
    expect(tookOf(played.report, 'p1a', 'crit')).toBe('applied');
    // the report holds the user's die only: the log's dice joined it and stay out of the user's view
    expect(played.report?.forced.length).toBe(1);
    expect(has(played.lines, '|move|p2a: Penal Battalion|Fire Fang|p1a: Corviknight|[miss]')).toBe(true);
    expect(has(played.lines, '|-crit|p2a: Penal Battalion')).toBe(true);
  });

  test('singles: a die of another action does not join the log when the user changed that action', { timeout: 300000 }, async () => {
    const crit = { name: { slot: 'p1a', moveId: 'bodypress', targetSlot: 'p2a', kind: 'crit' as const }, result: { happens: true } };
    const { replay, runtime } = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    // p2 clicks another move than the log's Fire Fang: the log's miss of Fire Fang must not carry over to it
    const battle = runtime.battleStream.battle!;
    const other = battle.sides[1].active[0]!.getMoveRequestData().moves.findIndex(move => move.id !== 'firefang') + 1;
    const played = await playTurn(runtime, replay.log, FIRE_FANG.turn, { p2: `move ${other}` }, { p1: [clickWith('bodypress', [crit])], p2: [] });
    expect(tookOf(played.report, 'p1a', 'crit')).toBe('applied');
    expect(has(played.lines, '|move|p2a: Penal Battalion|Fire Fang|')).toBe(false);
  });

  test('doubles (Doubles OU 2663093831 t8): one forced die joins the log and the turn plays with the logged hit counts', { timeout: 300000 }, async () => {
    const noBurn = { name: { slot: 'p1a', moveId: 'matchagotcha', targetSlot: 'p2b', kind: 'secondary' as const, effectId: 'brn' }, result: { happens: false } };
    const { replay, runtime } = await reconstruct(DOUBLES.fixture, DOUBLES.turn, DOUBLES.source);
    const played = await playTurn(runtime, replay.log, DOUBLES.turn, undefined, { p1: [clickWith('matchagotcha', [noBurn]), null], p2: [] });
    expect(tookOf(played.report, 'p1a', 'secondary')).toBe('applied');
    expect(played.report?.forced.length).toBe(1);
    expect(has(played.lines, '|-status|p2b: tea pot|brn')).toBe(false);
  });

  // Round 82 (A7d, gate answer 2a): the first turn joins the log with or without a die of the user's.
  test('singles (t73): a first turn with no forced die shows the Fire Fang miss and lists no die', { timeout: 300000 }, async () => {
    const { replay, runtime } = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    const played = await playTurn(runtime, replay.log, FIRE_FANG.turn, undefined, { p1: [clickWith('bodypress')], p2: [] });
    expect(has(played.lines, '|move|p2a: Penal Battalion|Fire Fang|p1a: Corviknight|[miss]')).toBe(true);
    expect(played.report).toBeUndefined();
  });

  test('doubles (t8): a first turn with no forced die plays the logged results and lists no die', { timeout: 300000 }, async () => {
    const { replay, runtime } = await reconstruct(DOUBLES.fixture, DOUBLES.turn, DOUBLES.source);
    const played = await playTurn(runtime, replay.log, DOUBLES.turn, undefined, { p1: [clickWith('matchagotcha'), null], p2: [] });
    expect(played.report).toBeUndefined();
    // the turn plays the logged crits and hit counts (the damage rolls stay with the seed, so the faint can still differ): the unjoined turn crits Kanye
    expect(has(played.lines, '|-crit|p2')).toBe(false);
    expect(played.score.softMismatches).toBeLessThan(4);
  });

  test('a first turn with no forced die on a position without a logged turn plays as the app plays it today', { timeout: 120000 }, async () => {
    const asked = await branchOf('gen9customgame', [mon('Pikachu', ['tackle'])], [mon('Snorlax', ['tackle'])], '1,2,3,4');
    const plain = await branchOf('gen9customgame', [mon('Pikachu', ['tackle'])], [mon('Snorlax', ['tackle'])], '1,2,3,4');
    const send = (runtime: typeof asked, dice: boolean) => executeBranchChoices({
      streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors,
      commands: [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }],
      ...(dice ? { dice: { battle: runtime.battleStream.battle!, p1Choices: [clickWith('tackle')], p2Choices: [clickWith('tackle')] } } : {}),
    });
    expect((await send(asked, true)).ok).toBe(true);
    expect((await send(plain, false)).ok).toBe(true);
    expect(asked.battleStream.battle!.log.filter(line => !line.startsWith('|t:|'))).toEqual(plain.battleStream.battle!.log.filter(line => !line.startsWith('|t:|')));
    expect(String(asked.battleStream.battle!.prng.getSeed())).toBe(String(plain.battleStream.battle!.prng.getSeed()));
  });

  test('criterion 3: the turn after the first plays byte for byte as without the dice argument', { timeout: 300000 }, async () => {
    const asked = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    const plain = await reconstruct(FIRE_FANG.fixture, FIRE_FANG.turn, FIRE_FANG.source);
    await playTurn(asked.runtime, asked.replay.log, FIRE_FANG.turn, undefined, { p1: [clickWith('bodypress')], p2: [] });
    await playTurn(plain.runtime, plain.replay.log, FIRE_FANG.turn, undefined, { p1: [clickWith('bodypress')], p2: [] });
    const second = (runtime: typeof asked.runtime, dice: boolean) => executeBranchChoices({
      streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors,
      commands: [{ side: 'p1', command: 'move 1' }, { side: 'p2', command: 'move 1' }],
      ...(dice ? { dice: { battle: runtime.battleStream.battle!, p1Choices: [clickWith('bodypress')], p2Choices: [] } } : {}),
    });
    const withArg = await second(asked.runtime, true);
    const without = await second(plain.runtime, false);
    expect(withArg.ok).toBe(true);
    expect(without.ok).toBe(true);
    expect(withArg.ok && withArg.dice).toBeFalsy();
    const lines = (runtime: typeof asked.runtime) => runtime.battleStream.battle!.log.filter(line => !line.startsWith('|t:|'));
    expect(lines(asked.runtime)).toEqual(lines(plain.runtime));
    expect(String(asked.runtime.battleStream.battle!.prng.getSeed())).toBe(String(plain.runtime.battleStream.battle!.prng.getSeed()));
  });
});
