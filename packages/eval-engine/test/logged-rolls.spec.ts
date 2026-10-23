import { test, expect, describe } from 'vitest';
import { PRNG } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { LoggedRollPRNG, type LoggedRolls } from '../src/branch/logged-rolls';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { drawsByAction, observeDraws, playTurn, prngOf, reconstruct, type Draw } from './arrival-turn';
import { loadSimMods } from '../src/forward/sim-mods';

// Round 75 (T160): a Champions game reads the registered Champions Dex, so the mod loads first, as the hosts do.
await loadSimMods('gen9championsou');

/**
 * Round 73, T232: the first turn of a branch keeps the logged dice of every action the user leaves as it was. Round 70 put the
 * position on the seed its turn has in the log, but one stream serves all actions in order: when the faster action's move
 * changes, the slower action draws later numbers of the stream and loses its logged roll (GPL DzBQ5azlO5l turn 16: Earthquake
 * replaced, Strength Sap rolled 13 where the log has 47). The dice are now per action (side, slot and move).
 *
 * The scenes are turns of the five fixtures the dice specs use, one per game type and rule set: the draws of every action are
 * read from the battle's PRNG as the sim calls it, keyed by the move in flight, so the assertions name the numbers and not
 * their effect on a line of the log (a changed faster move also changes the HP the slower hit lands on).
 */

interface Scene {
  label: string;
  fixture: string;
  turn: number;
  /** The faster side's click that replaces the logged one: its side, the slot's position in the side's choice and the click. */
  changed: { side: 'p1' | 'p2'; slot: number; click: string };
  /** The actions (slot:move) whose draws the log has and the change leaves alone. */
  kept: string[];
  /** A line a kept action's roll writes in the log (a secondary effect, a critical hit): the rebuilt turn shows it too. */
  marker?: RegExp;
  /** Whether the seed stream reaches the changed action at the same place with or without the log's numbers (not when a kept action with a priority move acts first and its logged number steers the draws). */
  onSeedPlace: boolean;
}

const SCENES: Scene[] = [
  { label: 'singles (GPL DzBQ5azlO5l turn 16, Earthquake replaced)', fixture: 'gpl-replay', turn: 16, changed: { side: 'p2', slot: 0, click: 'move 2' }, kept: ['p1a:strengthsap'], onSeedPlace: true },
  { label: 'singles (GPL DzBQ5azlO5l turn 16, a switch instead of the move)', fixture: 'gpl-replay', turn: 16, changed: { side: 'p2', slot: 0, click: 'switch 2' }, kept: ['p1a:strengthsap'], onSeedPlace: true },
  { label: 'doubles (Doubles OU 912884 turn 10, Fake Out replaced)', fixture: 'smogtours-gen9doublesou-912884', turn: 10, changed: { side: 'p1', slot: 0, click: 'move 1 1' }, kept: ['p2a:knockoff', 'p1b:matchagotcha'], marker: /^|-status|p2a: JOHN MAMMAL|brn/, onSeedPlace: true },
  { label: 'VGC (Regulation I 2630181744 turn 3, High Horsepower replaced)', fixture: 'gen9vgc2026regi-2630181744', turn: 3, changed: { side: 'p2', slot: 0, click: 'move 2 1' }, kept: ['p1b:astralbarrage', 'p1a:sunsteelstrike'], onSeedPlace: true },
  { label: 'VGC (Regulation I 2630181744 turn 6, Psychic replaced, the foe\'s Protect fails as in the log)', fixture: 'gen9vgc2026regi-2630181744', turn: 6, changed: { side: 'p1', slot: 1, click: 'move 1' }, kept: ['p2a:protect', 'p2b:heavyslam'], marker: /^\|-fail\|p2a: Calyrex/, onSeedPlace: false },
  { label: 'Champions OU (2693832490 turn 2, Shadow Ball replaced)', fixture: 'champions/gen9championsou-2693832490', turn: 2, changed: { side: 'p2', slot: 0, click: 'move 1' }, kept: ['p1a:weatherball'], onSeedPlace: true },
  { label: 'Champions VGC (2679053861 turn 3, Twin Beam replaced)', fixture: 'champions/gen9championsvgc2026regmbbo3-2679053861', turn: 3, changed: { side: 'p2', slot: 1, click: 'move 4 1' }, kept: ['p2a:sacredsword', 'p1b:psychic'], marker: /^|-crit|p1a: Penny Parker/, onSeedPlace: true },
];

/** The logged turn, with the dice read, and the same turn with one slot's click replaced. */
async function play(scene: Scene, replaced: boolean, plainSeed = false) {
  const { replay, runtime } = await reconstruct(scene.fixture, scene.turn);
  const battle = runtime.battleStream.battle!;
  if (plainSeed) battle.prng = new PRNG(prngOf(runtime));
  const draws = observeDraws(battle);
  const block = parseTurnBlocks(replay.log).turns.find(entry => entry.turn === scene.turn)!;
  const clicks = replaced ? getMainChoice(block.preUpkeep, scene.changed.side, battle).split(', ') : [];
  if (replaced) clicks[scene.changed.slot] = scene.changed.click;
  const played = await playTurn(runtime, replay.log, scene.turn, replaced ? { [scene.changed.side]: clicks.join(', ') } : undefined);
  return { draws, byAction: drawsByAction(draws), lines: played.lines };
}

const values = (draws: Draw[] | undefined) => draws?.map(draw => [draw.from, draw.to, draw.value]);

/** The draws of `wanted` that stand in `seen` in the same order, each matched on its shape and its number. */
function asSubsequence(wanted: Draw[], seen: Draw[]) {
  const found: Draw[] = [];
  let at = 0;
  for (const draw of wanted) {
    const index = seen.findIndex((entry, position) => position >= at && entry.from === draw.from && entry.to === draw.to && entry.value === draw.value);
    if (index < 0) break;
    found.push(seen[index]);
    at = index + 1;
  }
  return values(found);
}

describe.each(SCENES.filter(scene => scene.marker))('the first branch turn keeps the secondary effect and the critical hit of the actions the user leaves as they were: $label', scene => {
  test('the marker line of a kept action is in the rebuilt turn as it is in the log', { timeout: 300000 }, async () => {
    const logged = await play(scene, false);
    const changed = await play(scene, true);
    expect(logged.lines.some(line => scene.marker!.test(line)), 'the log has the marker').toBe(true);
    expect(changed.lines.some(line => scene.marker!.test(line)), 'the rebuilt turn has it').toBe(true);
  });
});

describe.each(SCENES)('the first branch turn keeps the logged dice of the actions the user leaves as they were: $label', scene => {
  test('the slower actions draw their logged numbers when the faster side clicks another move', { timeout: 300000 }, async () => {
    const logged = await play(scene, false);
    const changed = await play(scene, true);
    const changedSlot = `${scene.changed.side}${'ab'[scene.changed.slot]}`;
    for (const key of scene.kept) {
      expect(logged.byAction.has(key), `${key} acts in the log`).toBe(true);
      // The logged numbers stand in the order the log has them; a target the change adds (a spread move the log rolled for once)
      // draws its extra numbers from the seed between them.
      const logs = logged.byAction.get(key)!;
      expect(asSubsequence(logs, changed.byAction.get(key) ?? []), key).toEqual(values(logs));
    }
    // The change is a real one: the faster slot's logged action no longer acts.
    for (const key of [...logged.byAction.keys()].filter(entry => entry.startsWith(changedSlot))) {
      expect(changed.byAction.has(key), `${key} is replaced`).toBe(false);
    }
  });

  test.runIf(scene.onSeedPlace)('the changed action itself draws from the seed, as it did before', { timeout: 300000 }, async () => {
    const changed = await play(scene, true);
    const plain = await play(scene, true, true);
    const changedSlot = `${scene.changed.side}${'ab'[scene.changed.slot]}`;
    for (const key of [...changed.byAction.keys()].filter(entry => entry.startsWith(changedSlot))) {
      expect(values(changed.byAction.get(key)), key).toEqual(values(plain.byAction.get(key)));
    }
  });

  test('a turn whose actions all stay as logged draws exactly what the plain seed gives', { timeout: 300000 }, async () => {
    const logged = await play(scene, false);
    const plain = await play(scene, false, true);
    expect(values(logged.draws)).toEqual(values(plain.draws));
    const untimed = (lines: string[]) => lines.filter(line => !line.startsWith('|t:|'));
    expect(untimed(logged.lines)).toEqual(untimed(plain.lines));
  });
});

describe('the logged dice are served by action, one turn, and only to a draw of the same shape', () => {
  const logged: LoggedRolls = new Map([['p1a:thunder', [{ from: 100, to: undefined, value: 7 }, { from: 16, to: undefined, value: 3 }]]]);
  const standing = (turn: number, move: string | null) =>
    ({ turn, activeMove: move ? { id: move } : null, activePokemon: move ? { getSlot: () => 'p1a' } : null }) as unknown as Battle;
  const seed = '1,2,3,4';
  const plain = (calls: Array<[number?, number?]>) => { const prng = new PRNG(seed); return calls.map(([from, to]) => prng.random(from, to)); };

  test('an action of the log draws its numbers in order; every other draw is the seed\'s', () => {
    const prng = new LoggedRollPRNG(seed, logged, 5);
    prng.attach(standing(5, 'thunder'));
    const natural = plain([[100], [16], [16]]);
    expect([prng.random(100), prng.random(16), prng.random(16)]).toEqual([7, 3, natural[2]]);
  });

  test('another move or another slot, a draw outside an action and another turn draw the seed\'s numbers', () => {
    const natural = plain([[100], [100], [100], [100]]);
    const prng = new LoggedRollPRNG(seed, logged, 5);
    prng.attach(standing(5, 'surf'));
    const first = prng.random(100);
    prng.attach(standing(5, null));
    const second = prng.random(100);
    prng.attach(standing(6, 'thunder'));
    const third = prng.random(100);
    expect([first, second, third]).toEqual(natural.slice(0, 3));
  });

  test('a draw of another shape than the next logged one is the seed\'s and leaves the log\'s place', () => {
    const prng = new LoggedRollPRNG(seed, logged, 5);
    prng.attach(standing(5, 'thunder'));
    const natural = plain([[24]]);
    expect(prng.random(24)).toBe(natural[0]);
    expect(prng.random(100)).toBe(7);
  });

  test('the seed stream advances on every call, answered or not', () => {
    const prng = new LoggedRollPRNG(seed, logged, 5);
    prng.attach(standing(5, 'thunder'));
    prng.random(100);
    prng.random(16);
    const reference = new PRNG(seed);
    reference.random(100);
    reference.random(16);
    expect(prng.getSeed()).toBe(reference.getSeed());
  });
});

describe('every draw of the sim reaches PRNG#random (the recorder and the replay stand on it)', () => {
  class Counting extends PRNG {
    calls = 0;
    override random(from?: number, to?: number): number {
      this.calls++;
      return super.random(from, to);
    }
  }
  test.each([
    ['randomChance', (prng: PRNG) => prng.randomChance(3, 10)],
    ['sample', (prng: PRNG) => prng.sample([1, 2, 3])],
    ['shuffle', (prng: PRNG) => prng.shuffle([1, 2, 3])],
  ])('%s', (_name, call) => {
    const prng = new Counting('1,2,3,4');
    call(prng);
    expect(prng.calls).toBeGreaterThan(0);
  });
});
