import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Dex, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { buildForcedSwitchChoice } from '../src/branch/corrections';
import { faintedSlots, logGoesOn, mayDisguise, shownBodyIds, type ProtocolBench } from '../src/branch/team-order';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * Round 73 (T250): a side that shows fewer species than its bring count keeps all six bodies, because the bring lists are
 * trimmed together or not at all (replay-format.ts, the symmetric rule of game 452654). At a forced replacement the protocol
 * never answers, the rebuild used to send the first living body of the bench: a phantom the player never brought
 * (gen9championsvgc2026regmbbo3-2687970740: Rotom-Heat and Swampert fought for Power Police's side). The game leaves the slot
 * empty; the simulator accepts that pass only when no living body waits on the bench, so the rebuild retires the bench bodies
 * the whole protocol never shows and answers pass.
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

/** The live pass the app and the bank run, built the way the app builds the teams (bring lists not passed unless the replay trims them). */
async function boundaries<T>(replay: Replay, turns: number[], read: (battle: Battle) => T) {
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
  const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
  const seen = new Map<number, T>();
  const targetTurn = Math.max(...turns) + 1;
  await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    targetTurn, snapshot: snapshotFor(targetTurn),
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
    capturePositions: {
      snapshotFor,
      onPosition: (turn, battle) => {
        if (turns.includes(turn) && !seen.has(turn)) seen.set(turn, read(battle));
      },
    },
  });
  return seen;
}

const living = (battle: Battle, side: 0 | 1) => battle.sides[side].pokemon.filter(entry => !entry.fainted).map(entry => entry.species.name);

describe('the scene: gen9championsvgc2026regmbbo3-2687970740 (Champions VGC, p2 shows its 4 of 4, p1 shows 3 of 4)', () => {
  const replay = fixture('gen9championsvgc2026regmbbo3-2687970740.json');
  const read = (battle: Battle) => ({
    p1Living: living(battle, 0), p2Living: living(battle, 1), p2Left: battle.sides[1].pokemonLeft,
    p2Active: battle.sides[1].active.map(entry => (entry && !entry.fainted ? entry.species.name : null)),
    p2Fainted: battle.sides[1].totalFainted,
  });

  test('after Floette fainted with nobody left to send, p2 has Meowstic alone: no phantom stands on the field or the bench', { timeout: 240000 }, async () => {
    const seen = await boundaries(replay, [7, 8], read);
    for (const turn of [7, 8]) {
      const board = seen.get(turn)!;
      expect(board.p2Living, `turn ${turn}`).toEqual(['Meowstic']);
      expect(board.p2Left, `turn ${turn}`).toBe(1);
      expect(board.p2Active.filter(Boolean), `turn ${turn}`).toEqual(['Meowstic']);
    }
  });
});

describe('the scene: the other side and the bring rule stay as they were', () => {
  const replay = fixture('gen9championsvgc2026regmbbo3-2687970740.json');

  test('p1 shows 3 of 4 and keeps all six bodies; the bring lists stay unpinned for both sides (the symmetric rule of 452654)', { timeout: 240000 }, async () => {
    expect(replayBringOnly(replay, parseReplayLog(replay.log))).toBeNull();
    const seen = await boundaries(replay, [7, 8], battle => ({ p1Living: living(battle, 0).length, p1Left: battle.sides[0].pokemonLeft }));
    for (const turn of [7, 8]) expect(seen.get(turn), `turn ${turn}`).toEqual({ p1Living: 6, p1Left: 6 });
  });

  test('the game ends where the log ends it: Power Police faints on turn 8 and p2 has nobody left', { timeout: 240000 }, async () => {
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: 9,
      snapshot: snapshots[snapshots.length - 1] ?? null,
    });
    const battle = runtime.battleStream.battle!;
    expect(battle.sides[1].pokemonLeft).toBe(0);
    expect(battle.ended).toBe(true);
  });

  test('the forfeit scene gen9doublesou-2694811367 turn 6: both p2 actives faint and the player forfeits; the bench he never sent stays alive (Cresselia)', { timeout: 240000 }, async () => {
    const forfeit = fixture('gen9doublesou-2694811367.json');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(forfeit.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(forfeit.log, { observations, speedOrders });
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(forfeit), p1Team, p2Team, replayLog: forfeit.log, targetTurn: 7,
      snapshot: snapshots[snapshots.length - 1] ?? null,
    });
    const side = runtime.battleStream.battle!.sides[1];
    expect(side.pokemon.find(entry => entry.species.name === 'Cresselia')?.fainted).toBe(false);
    expect(side.pokemonLeft).toBe(1);
  });

  test('the shown bodies of a side: the names and base species of its switch, drag, replace and detailschange lines (CRLF too)', () => {
    const shown = shownBodyIds(replay.log.replace(/\n/g, '\r\n'), 'p2');
    for (const id of ['powerpolice', 'meowstic', 'breezy', 'scrafty', 'grayman', 'aerodactyl', 'liberation', 'floette']) expect(shown.has(id), id).toBe(true);
    for (const id of ['swampert', 'rotomheat', 'sceptile', 'toxicroak']) expect(shown.has(id), id).toBe(false);
  });
});

const mon = (species: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function board(format: string, p1: PokemonSet[], p2: PokemonSet[], choices: [string, string]): LiveBattle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  battle.choose('p1', choices[0]);
  battle.choose('p2', choices[1]);
  return battle;
}

/** What the protocol says about the side: these bodies shown, and by default a faint on both slots in the block. */
const benchOf = (species: string[], fainted = [0, 1], goesOn = true): ProtocolBench => ({
  shown: new Set(species.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, ''))), fainted: new Set(fainted), goesOn,
});
const livingNames = (battle: LiveBattle, side: 0 | 1) => battle.sides[side].pokemon.filter(entry => !entry.fainted).map(entry => entry.name);

/** Memento: the user faints whatever else happens, so the side must replace the slot (p2's request is a forced switch). */
const SINGLES_P1 = [mon('Pikachu', 'Static', ['Splash'])];
const DOUBLES_P1 = [mon('Pikachu', 'Static', ['Splash']), mon('Eevee', 'Run Away', ['Splash']), mon('Gible', 'Sand Veil', ['Splash'])];
const memento = (species: string) => mon(species, 'Soundproof', ['Memento']);
const splash = (species: string, ability: string) => mon(species, ability, ['Splash']);

describe('retiring the bench the protocol never shows, against the simulator (singles and doubles)', () => {
  test('singles: the last shown body faints, two unshown bodies wait: they leave, the side has nobody, the game ends as the log does', () => {
    const battle = board('gen9customgame', SINGLES_P1,
      [memento('Voltorb'), splash('Magikarp', 'Swift Swim'), splash('Ditto', 'Limber')], ['move 1', 'move 1']);
    expect(battle.sides[1].activeRequest).toMatchObject({ forceSwitch: [true] });
    const choice = buildForcedSwitchChoice(battle as never, 1, [], { current: 0 }, benchOf(['Voltorb', 'Pikachu']));
    expect(choice).toBeNull();
    expect(battle.ended).toBe(true);
    expect(battle.winner).toBe('A');
    expect(livingNames(battle, 1)).toEqual([]);
    expect(battle.sides[1].totalFainted).toBe(1);
  });

  test('doubles: one slot empty, two unshown bodies wait: pass is the simulator\'s own answer and the turn goes on', () => {
    const teams = [memento('Voltorb'), splash('Ditto', 'Limber'), splash('Magikarp', 'Swift Swim'), splash('Feebas', 'Swift Swim')];
    const old = board('gen9doublescustomgame', DOUBLES_P1, teams, ['move 1, move 1', 'move 1 1, move 1']);
    expect(buildForcedSwitchChoice(old as never, 1, [], { current: 0 })).toBe('switch 3, pass');
    const battle = board('gen9doublescustomgame', DOUBLES_P1, teams, ['move 1, move 1', 'move 1 1, move 1']);
    expect(battle.sides[1].activeRequest).toMatchObject({ forceSwitch: [true, false] });
    const choice = buildForcedSwitchChoice(battle as never, 1, [], { current: 0 }, benchOf(['Voltorb', 'Ditto']));
    expect(choice).toBe('pass, pass');
    expect(livingNames(battle, 1)).toEqual(['Ditto']);
    expect(battle.sides[1].pokemonLeft).toBe(1);
    expect(battle.sides[1].totalFainted).toBe(1);
    const turn = battle.turn;
    battle.choose('p2', choice!);
    expect(battle.sides[1].choice.error).toBe('');
    expect(battle.turn).toBe(turn + 1);
    expect(battle.sides[1].active[0]!.fainted).toBe(true);
  });

  test('doubles: two slots empty, the log answers one: the answer stays and the other slot passes', () => {
    const battle = board('gen9doublescustomgame', DOUBLES_P1,
      [memento('Voltorb'), memento('Electrode'), splash('Ditto', 'Limber'), splash('Magikarp', 'Swift Swim')],
      ['move 1, move 1', 'move 1 1, move 1 2']);
    expect(battle.sides[1].activeRequest).toMatchObject({ forceSwitch: [true, true] });
    const choice = buildForcedSwitchChoice(battle as never, 1, ['Ditto'], { current: 0 }, benchOf(['Voltorb', 'Electrode', 'Ditto']));
    expect(choice).toBe('switch 3, pass');
    expect(livingNames(battle, 1)).toEqual(['Ditto']);
    const turn = battle.turn;
    battle.choose('p2', choice!);
    expect(battle.sides[1].choice.error).toBe('');
    expect(battle.turn).toBe(turn + 1);
    expect(battle.sides[1].active.map(entry => entry!.name)).toEqual(['Ditto', 'Electrode']);
  });

  test('controls: a bench body the protocol shows later, or one that may disguise itself, keeps the old answer and nobody leaves', () => {
    const shownLater = board('gen9doublescustomgame', DOUBLES_P1,
      [memento('Voltorb'), splash('Ditto', 'Limber'), splash('Magikarp', 'Swift Swim'), splash('Feebas', 'Swift Swim')],
      ['move 1, move 1', 'move 1 1, move 1']);
    expect(buildForcedSwitchChoice(shownLater as never, 1, [], { current: 0 }, benchOf(['Voltorb', 'Ditto', 'Magikarp']))).toBe('switch 3, pass');
    expect(livingNames(shownLater, 1)).toEqual(['Ditto', 'Magikarp', 'Feebas']);

    const illusion = board('gen9doublescustomgame', DOUBLES_P1,
      [memento('Voltorb'), splash('Ditto', 'Limber'), splash('Zoroark', 'Illusion'), splash('Feebas', 'Swift Swim')],
      ['move 1, move 1', 'move 1 1, move 1']);
    expect(buildForcedSwitchChoice(illusion as never, 1, [], { current: 0 }, benchOf(['Voltorb', 'Ditto']))).toBe('switch 3, pass');
    expect(livingNames(illusion, 1)).toEqual(['Ditto', 'Zoroark', 'Feebas']);
  });

  test('controls: the simulators own faint, with no faint line for the slot in the block, keeps the old answer: the sim diverged, not the bring list', () => {
    const battle = board('gen9customgame', SINGLES_P1, [memento('Voltorb'), splash('Magikarp', 'Swift Swim')], ['move 1', 'move 1']);
    expect(buildForcedSwitchChoice(battle as never, 1, [], { current: 0 }, benchOf(['Voltorb'], []))).toBe('switch 2');
    expect(livingNames(battle, 1)).toEqual(['Magikarp']);
    expect(battle.ended).toBe(false);
  });

  test('controls: the log ends with this block (a forfeit, a win or a tie follows): the bench stays and the old answer stands, in singles and doubles', () => {
    const singles = board('gen9customgame', SINGLES_P1,
      [memento('Voltorb'), splash('Magikarp', 'Swift Swim'), splash('Ditto', 'Limber')], ['move 1', 'move 1']);
    expect(buildForcedSwitchChoice(singles as never, 1, [], { current: 0 }, benchOf(['Voltorb', 'Pikachu'], [0, 1], false))).toBe('switch 2');
    expect(singles.ended).toBe(false);
    expect(livingNames(singles, 1)).toEqual(['Magikarp', 'Ditto']);
    const doubles = board('gen9doublescustomgame', DOUBLES_P1,
      [memento('Voltorb'), splash('Ditto', 'Limber'), splash('Magikarp', 'Swift Swim'), splash('Feebas', 'Swift Swim')],
      ['move 1, move 1', 'move 1 1, move 1']);
    expect(buildForcedSwitchChoice(doubles as never, 1, [], { current: 0 }, benchOf(['Voltorb', 'Ditto'], [0, 1], false))).toBe('switch 3, pass');
    expect(livingNames(doubles, 1)).toEqual(['Ditto', 'Magikarp', 'Feebas']);
  });

  test('the block goes on past the turn when a later turn line exists (the forfeit scene has none, the 2687970740 scene does)', () => {
    const forfeit = fixture('gen9doublesou-2694811367.json');
    expect(logGoesOn(forfeit.log, 6)).toBe(false);
    expect(logGoesOn(forfeit.log.replace(/\n/g, '\r\n'), 6)).toBe(false);
    expect(logGoesOn(forfeit.log, 5)).toBe(true);
    const scene = fixture('gen9championsvgc2026regmbbo3-2687970740.json');
    expect(logGoesOn(scene.log, 6)).toBe(true);
    expect(logGoesOn(scene.log.replace(/\n/g, '\r\n'), 6)).toBe(true);
  });

  test('the faint slots of a block: the slot letters of its faint lines for one side (CRLF too)', () => {
    const lines = ['|faint|p2a: Liberation\r', '|move|p1a: X|Y|p2b: Z', '|faint|p1b: Q', '|faint|p2b: Power Police'];
    expect([...faintedSlots(lines, 'p2')]).toEqual([0, 1]);
    expect([...faintedSlots(lines, 'p1')]).toEqual([1]);
  });

  test('without the shown set the answer is the old one (the trial and the callers that pass none)', () => {
    const battle = board('gen9customgame', SINGLES_P1, [memento('Voltorb'), splash('Magikarp', 'Swift Swim')], ['move 1', 'move 1']);
    expect(buildForcedSwitchChoice(battle as never, 1, [], { current: 0 })).toBe('switch 2');
    expect(battle.ended).toBe(false);
  });
});

await loadSimMods('gen9championsou');

describe('the disguise guard reads the Dex: every ability with a BeforeSwitchIn handler marks its holder, in every generation and the Champions mod', () => {
  const formats = ['gen3customgame', 'gen4customgame', 'gen5customgame', 'gen6customgame', 'gen7customgame', 'gen8customgame', 'gen9customgame', 'gen9championscustomgame'];
  const handlerOf = (ability: object) => typeof (ability as { onBeforeSwitchIn?: unknown }).onBeforeSwitchIn === 'function';
  for (const format of formats) {
    test(format, () => {
      const dex = Dex.forFormat(format);
      const withHandler = dex.abilities.all().filter(handlerOf);
      const without = dex.abilities.all().filter(ability => ability.exists && !handlerOf(ability)).slice(0, 5);
      const holder = (ability: string) => new LiveBattle({
        formatid: format as never, seed: [1, 2, 3, 4],
        p1: { name: 'A', team: Teams.pack([mon('Pikachu', ability, ['Splash'])]) }, p2: { name: 'B', team: Teams.pack([mon('Pikachu', 'Static', ['Splash'])]) },
      }).sides[0].pokemon[0];
      for (const ability of withHandler) expect(mayDisguise(holder(ability.name) as never), ability.name).toBe(true);
      for (const ability of without) expect(mayDisguise(holder(ability.name) as never), ability.name).toBe(false);
      if (format === 'gen9customgame') expect(withHandler.map(ability => ability.id)).toContain('illusion');
    });
  }
});
