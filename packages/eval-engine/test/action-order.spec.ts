import { afterAll, describe, expect, test, beforeAll } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { copyOf, FixedDice } from '../src/sim-ask/copy';
import { actionPriority, queuePlace } from '../src/sim-ask/action-order';
import { askCheckOn, AskLeak, setAskCheck } from '../src/sim-ask/guard';
import { mon, RULES, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';
import { readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
  type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';

/**
 * `queuePlace` and `actionPriority` read the live battle the rebuild plays turn after turn: a value read in one turn must never
 * answer a later turn (Trick Room, Tailwind, paralysis, a stat stage, a switch, a knocked-off item, an item or ability that gains a
 * priority handler). Scene: 2630685175 turn 5, Trick Room: Fake Out's user read the speed of turn 4 (105 for 1703) and the cant
 * stand-in of the flinching body got no move. Each row asks one body, changes the battle the way the simulator does, asks again, and
 * must equal a never-asked battle and `getActionSpeed()`; it also checks that the change moved the answer. Singles and doubles, with
 * the development check off and on (on, a memo throws `AskLeak` at the second question).
 */

const GEN9 = RULES.find(rules => rules.generation === 9 && rules.name === 'Gen 9')!;
const MODES: Mode[] = ['singles', 'doubles'];

interface Change {
  name: string;
  move: string;
  item?: string;
  ability?: string;
  prepare?(battle: Battle, body: Pokemon): void;
  apply(battle: Battle, body: Pokemon, mode: Mode): void;
  moves: 'speed' | 'priority';
  chance?: boolean;
}

const play = (battle: Battle, mode: Mode, p1: string): void => {
  if (mode === 'singles') battle.makeChoices(p1, 'move 1');
  else battle.makeChoices(`${p1}, move 1`, 'move 1, move 1');
};

const CHANGES: Change[] = [
  { name: 'paralysis', move: 'tackle', moves: 'speed', apply: (_battle, body) => { body.setStatus('par'); } },
  { name: 'a speed stage', move: 'tackle', moves: 'speed', apply: (_battle, body) => { body.boostBy({ spe: 2 }); } },
  { name: 'Trick Room set', move: 'tackle', moves: 'speed', apply: (battle, body) => { battle.field.addPseudoWeather('trickroom', body); } },
  { name: 'Tailwind set', move: 'tackle', moves: 'speed', apply: (_battle, body) => { body.side.addSideCondition('tailwind', body); } },
  { name: 'Choice Scarf knocked off', move: 'tackle', item: 'choicescarf', moves: 'speed', apply: (_battle, body) => { body.takeItem(); } },
  {
    name: 'a boosted body that switches out and comes back', move: 'tackle', moves: 'speed',
    prepare: (_battle, body) => { body.boostBy({ spe: 2 }); },
    apply: (battle, _body, mode) => {
      play(battle, mode, 'switch 3');
      play(battle, mode, 'switch 3');
    },
  },
  { name: 'Prankster gained (ability change)', move: 'thunderwave', moves: 'priority', apply: (_battle, body) => { body.setAbility('prankster'); } },
  { name: 'Quick Claw gained (item change)', move: 'tackle', moves: 'priority', chance: true, apply: (_battle, body) => { body.setItem('quickclaw'); } },
  { name: 'Quick Claw knocked off (a handler that was there, answered by the copy)', move: 'tackle', item: 'quickclaw', moves: 'priority', chance: true, apply: (_battle, body) => { body.takeItem(); } },
];

function sceneOf(rules: Rules, mode: Mode, change: Change): { battle: Battle; body: Pokemon } {
  const plain = (species: string) => mon(rules, { species, moves: ['splash', 'tackle', 'thunderwave'] });
  const holder = { ...plain('Snorlax'), ...(change.item ? { item: change.item } : {}), ...(change.ability ? { ability: change.ability } : {}) };
  const p1 = mode === 'singles' ? [holder, plain('Blissey'), plain('Chansey')] : [holder, plain('Blissey'), plain('Chansey'), plain('Pikachu')];
  const p2 = mode === 'singles' ? [plain('Vaporeon')] : [plain('Vaporeon'), plain('Jolteon')];
  const battle = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, p2);
  return { battle, body: battle.sides[0].active[0] as Pokemon };
}

const unasked = (battle: Battle, body: Pokemon, move: string, chance: boolean) => {
  const copy = copyOf(battle);
  const same = copy.sides[0].pokemon[body.side.pokemon.indexOf(body)];
  const check = askCheckOn();
  setAskCheck(false); // a copy has no live prng to fingerprint
  try { return queuePlace(copy, same, move, chance); } finally { setAskCheck(check); }
};

afterAll(() => setAskCheck(null));

describe.each(MODES)('a body asked twice on one live battle: %s', mode => {
  describe.each([false, true])('development check %s', check => {
    test.each(CHANGES.map(change => [change.name, change] as const))('%s', (_name, change) => {
      setAskCheck(check);
      const chance = change.chance ?? false;
      const { battle, body } = sceneOf(GEN9, mode, change);
      change.prepare?.(battle, body);
      const before = queuePlace(battle, body, change.move, chance);
      change.apply(battle, battle.sides[0].active[0] as Pokemon, mode);
      const now = battle.sides[0].active[0] as Pokemon;
      const expected = unasked(battle, now, change.move, chance);
      const after = queuePlace(battle, now, change.move, chance);
      // the row proves its change: the answer a never-asked battle gives is not the first one
      expect(change.moves === 'speed' ? expected.speed : expected.priority).not.toBe(change.moves === 'speed' ? before.speed : before.priority);
      expect(after).toEqual({ priority: expected.priority, speed: expected.speed });
      expect(after.speed).toBe(now.getActionSpeed());
      expect(actionPriority(battle, now, change.move, chance)).toBe(expected.priority);
    });
  });

  test('the check on a body whose answers did not change stays silent', () => {
    setAskCheck(true);
    const { battle, body } = sceneOf(GEN9, mode, { name: 'none', move: 'tackle', moves: 'speed', apply: () => {} });
    const first = queuePlace(battle, body, 'tackle', false);
    expect(() => queuePlace(battle, body, 'tackle', false)).not.toThrow(AskLeak);
    expect(queuePlace(battle, body, 'tackle', false)).toEqual(first);
  });
});

describe('stand-in-order', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmc-2710981835.json', import.meta.url), 'utf-8')) as ReplayData;
  const MOVE_LINES = /^\|(move|faint|cant|win)\|/;
  const REPORTED_SET = ['extremespeed', 'dragonpulse', 'thunderbolt', 'protect'];

  interface Scene { battle: SimBattle; preUpkeep: string[]; logged: string[] }

  /**
   * The battle at the start of turn 7 as the app rebuilds it, with the teams the log gives; `dragonite` replaces the moves of the p1
   * Dragonite.
   */
  async function sceneOf(dragonite?: string[]): Promise<Scene> {
    await loadSimMods(getBranchSimulatorFormat(replay));
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    if (dragonite) {
      const body = p1Team.find(set => set.species.startsWith('Dragonite'));
      if (!body) throw new Error('no Dragonite on the p1 team');
      body.moves = dragonite;
    }
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: 7, snapshot: snapshots[6] ?? null,
      playerNames: [replay.players[0], replay.players[1]],
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      deadlineMs: 120_000,
    });
    const block = parseTurnBlocks(replay.log).turns.find(turn => turn.turn === 7)!;
    return {
      battle: runtime.battleStream.battle as unknown as SimBattle, preUpkeep: block.preUpkeep,
      logged: [...block.preUpkeep, ...block.postUpkeep].filter(line => MOVE_LINES.test(line)),
    };
  }

  describe.each([
    ['the teams the log gives', undefined],
    ['the moves of the report (Extreme Speed first)', REPORTED_SET],
  ] as [string, string[] | undefined][])('turn 7 with %s', (_name, moves) => {
    let scene: Scene;
    beforeAll(async () => { scene = await sceneOf(moves); }, 240_000);

    const standIn = (): { id: string; choice: string } => {
      const choice = getMainChoice(scene.preUpkeep, 'p1', scene.battle);
      const slot = Number(/^move (\d+)/.exec(choice)![1]);
      return { id: scene.battle.sides[0].active[0]!.getMoveRequestData().moves[slot - 1].id, choice };
    };

    test('the position is turn 7 with Dragonite-Mega behind Floette-Mega', () => {
      const [dragonite, floette] = [scene.battle.sides[0].active[0]!, scene.battle.sides[1].active[0]!];
      expect([scene.battle.turn, dragonite.species.name, floette.species.name]).toEqual([7, 'Dragonite-Mega', 'Floette-Mega']);
      expect(dragonite.getActionSpeed()).toBeLessThan(floette.getActionSpeed());
    });

    test('the stand-in of Dragonite stands at priority 0 or below: no Extreme Speed (+2), no Protect (+4)', () => {
      const { id } = standIn();
      expect(['extremespeed', 'protect']).not.toContain(id);
      const dragonite = scene.battle.sides[0].active[0]!;
      for (const chance of [false, true]) expect(actionPriority(scene.battle, dragonite, id, chance)).toBeLessThanOrEqual(0);
    });

    // The simulator's damage roll is not the log's, so Dragonite may survive Dazzling Gleam in the emitted block (it then moves, behind
    // Floette); what the stand-in decides is the order of the move lines: nothing opens the turn but Floette, and the log's moves that the simulator also shows keep the log's order (a high roll can knock Empoleon out as well).
    test.each([false, true])('the turn the simulator emits (dice answer %s) opens with Floette and keeps the log\'s order of moves', chance => {
      const copy = copyOf(scene.battle);
      copy.prng = new FixedDice({ chance });
      const start = copy.log.length;
      copy.makeChoices(getMainChoice(scene.preUpkeep, 'p1', scene.battle), getMainChoice(scene.preUpkeep, 'p2', scene.battle));
      const key = (line: string): string => line.split('|').slice(1, 4).join('|');
      const moves = (lines: string[]): string[] => lines.filter(line => line.startsWith('|move|')).map(key);
      const emitted = moves(copy.log.slice(start));
      const logged = moves(scene.logged);
      expect(logged).toEqual(['move|p2a: Floette|Dazzling Gleam', 'move|p1b: Empoleon|Flash Cannon']);
      expect(emitted[0]).toBe(logged[0]);
      const shared = emitted.filter(move => logged.includes(move));
      expect(shared).toEqual(logged.slice(0, shared.length));
    });
  });

  describe('the contrast: the moves the grading offered for Dragonite', () => {
    test('Extreme Speed (+2) and Protect (+4) open the turn ahead of Floette, so the log rules them out', async () => {
      const scene = await sceneOf(REPORTED_SET);
      const clicks = { extremespeed: 'move 1 +1, move 1 +1', protect: 'move 4, move 1 +1' };
      for (const [id, click] of Object.entries(clicks)) {
        const copy = copyOf(scene.battle);
        copy.prng = new FixedDice({ chance: false });
        const start = copy.log.length;
        copy.makeChoices(click, getMainChoice(scene.preUpkeep, 'p2', scene.battle));
        const first = copy.log.slice(start).find(line => line.startsWith('|move|'))!;
        expect([id, first.split('|')[2]]).toEqual([id, 'p1a: Dragonite']);
      }
    }, 240_000);
  });
});
