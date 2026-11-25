import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { findPlayedOption } from '../src/analysis';
import { createRootPosition, type positionBattle } from '../src/forward-model';
import { LAYER_CAPS, failsAgainstStanding, searchOptions } from '../src/search/options';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

// Side.addSideCondition fails a standing condition without a restart handler (`onSideRestart`);
// Spikes and Toxic Spikes have one and refuse a layer past their cap, held here as `LAYER_CAPS`.

type Side = ReturnType<typeof positionBattle>['sides'][number];

const isReal = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future' && !move.isMax && !move.isZ;
};

type Weather = '' | 'snow' | 'hail';
const WEATHERS: Weather[] = ['', 'snow', 'hail'];

function prepared(view: SimView, moveId: string, weather: Weather, layers: number) {
  const move = view.dex.moves.get(moveId);
  const battle = battleIn(view, [mon('Blissey', [moveId, 'splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  const user = battle.sides[0].active[0];
  if (weather) battle.field.setWeather(weather, user);
  const holder: 0 | 1 = move.target === 'foeSide' ? 1 : 0;
  for (let count = 0; count < layers; count++) if (!battle.sides[holder].addSideCondition(move.sideCondition!, user)) break;
  return { battle, holder };
}

function play(view: SimView, moveId: string, standing: boolean, weather: Weather): boolean {
  const { battle } = prepared(view, moveId, weather, standing ? 9 : 0);
  const mark = battle.log.length;
  battle.choose('p1', view.doubles ? 'move 1, move 1' : 'move 1');
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  const turn = battle.log.slice(mark);
  const moved = turn.findIndex(line => line.startsWith('|move|p1a'));
  if (moved < 0) return false;
  const next = turn.findIndex((line, index) => index > moved && line.startsWith('|move|'));
  return turn.slice(moved + 1, next < 0 ? undefined : next).some(line => line.startsWith('|-fail|'));
}

function simulatorFails(view: SimView, moveId: string): boolean {
  return WEATHERS.some(weather => {
    return !play(view, moveId, false, weather) && play(view, moveId, true, weather);
  });
}

describe('field moves against a standing condition are read from the Dex and held to the simulator', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    const setters = [...new Set(view.dex.moves.all().filter(move => isReal(view, move.id) && move.sideCondition).map(move => move.id))].sort();

    const restarts = (id: string) => typeof (view.dex.conditions.get(view.dex.moves.get(id).sideCondition!) as unknown as { onSideRestart?: unknown }).onSideRestart === 'function';

    const dropped = () => setters.filter(id => {
      const { battle } = prepared(view, id, WEATHERS.find(w => !play(view, id, false, w) && play(view, id, true, w)) ?? '', 9);
      return failsAgainstStanding(battle.dex, id, battle.sides[0] as unknown as Side, battle.sides[1] as unknown as Side);
    });

    test('the moves it drops are the moves the simulator fails, no more and no fewer', () => {
      expect(dropped()).toEqual(setters.filter(id => simulatorFails(view, id)));
    });

    test('the moves the hand table lacked are dropped where the view has them', () => {
      const lacked = ['craftyshield', 'luckychant', 'matblock'].filter(id => setters.includes(id));
      expect(dropped()).toEqual(expect.arrayContaining(lacked));
      if (view.dex.gen === 2) expect(dropped()).toContain('spikes');
    });

    test('a stack below the cap of a layered hazard is no no-op, and the cap is what the simulator takes', () => {
      for (const id of setters.filter(name => name in LAYER_CAPS && restarts(name))) {
        const weather = WEATHERS.find(w => !play(view, id, false, w) && play(view, id, true, w)) ?? '';
        const full = prepared(view, id, weather, 9);
        const layers = (full.battle.sides[full.holder].sideConditions[view.dex.moves.get(id).sideCondition!] as { layers?: number } | undefined)?.layers;
        expect(layers, `${id} stack`).toBe(LAYER_CAPS[id]);
        const below = prepared(view, id, weather, layers! - 1);
        expect(failsAgainstStanding(below.battle.dex, id, below.battle.sides[0] as unknown as Side, below.battle.sides[1] as unknown as Side), `${id} one layer below the cap`).toBe(false);
      }
    });

    test('the layered hazards are the conditions with a restart handler, and Generation 2 has none', () => {
      expect(setters.filter(restarts)).toEqual(view.dex.gen === 2 ? [] : setters.filter(id => id in LAYER_CAPS));
    });
  });
});

// A move its own Try handler refuses by the body (action count, sleep) is no option; the Try event is the oracle.

type Move = ReturnType<SimView['dex']['moves']['get']>;
type Outcome = 'refused' | 'tried' | 'idle' | 'unoffered';

const FILLER = 'splash';
const hasTry = (move: Move): boolean => typeof (move as { onTry?: unknown }).onTry === 'function' || !!(move as { sleepUsable?: boolean }).sleepUsable;
const candidates = (view: SimView): string[] =>
  [...new Set(view.dex.moves.all().filter(move => isReal(view, move.id) && hasTry(move) && move.id !== FILLER).map(move => move.id))].sort();

function board(view: SimView, moveId: string, counter: number, asleep: boolean): Battle {
  const team = () => [mon('Blissey', [moveId, FILLER]), mon('Blissey', [FILLER])];
  const battle = battleIn(view, team(), [mon('Snorlax', [FILLER]), mon('Snorlax', [FILLER])]);
  for (let turn = 0; turn < counter; turn++) {
    battle.choose('p1', view.doubles ? 'move 2, move 1' : 'move 2');
    battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  }
  if (asleep) {
    const body = battle.sides[0].active[0]!;
    body.setStatus('slp');
    body.statusState.time = 9;
    body.statusState.startTime = 9;
  }
  return battle;
}

// The simulator's verdict: what its Try event answers for the clicked move (generations print a failure in other ways).
function outcome(view: SimView, moveId: string, counter: number, asleep: boolean): Outcome {
  const battle = board(view, moveId, counter, asleep);
  let verdict: Outcome = 'idle';
  const original = battle.singleEvent.bind(battle);
  battle.singleEvent = ((eventid: string, effect: { id: string; effectType: string }, ...rest: unknown[]) => {
    const answer = (original as (...args: unknown[]) => unknown)(eventid, effect, ...rest);
    if (eventid === 'Try' && effect.effectType === 'Move' && effect.id === moveId) verdict = answer ? 'tried' : 'refused';
    return answer;
  }) as typeof battle.singleEvent;
  const clicks = view.doubles ? ['move 1 1, move 1', 'move 1, move 1'] : ['move 1'];
  if (!clicks.some(click => battle.choose('p1', click))) return 'unoffered';
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  return verdict;
}

const rootOf = (battle: Battle) => createRootPosition(JSON.stringify(State.serializeBattle(battle)));
const firstPart = (choice: string): string => choice.split(',')[0].trim();
const listsMove = (options: { choice: string }[], moveId: string): boolean =>
  options.some(option => firstPart(option.choice) === `move ${moveId}` || firstPart(option.choice).startsWith(`move ${moveId} `));

function listed(view: SimView, moveId: string, counter: number, asleep: boolean): boolean {
  return listsMove(searchOptions(rootOf(board(view, moveId, counter, asleep)), 'p1'), moveId);
}

interface Truth { fresh: Outcome; once: Outcome; twice: Outcome }

const truthOf = (view: SimView, moveId: string): Truth => ({
  fresh: outcome(view, moveId, 0, false),
  once: outcome(view, moveId, 1, false),
  twice: outcome(view, moveId, 2, false),
});

const turnsAway = (outcome: Outcome): boolean => outcome === 'refused' || outcome === 'unoffered';
const firstTurnOnly = (truth: Truth): boolean => truth.fresh === 'tried' && turnsAway(truth.once) && turnsAway(truth.twice);

describe('a move its own handler refuses by the body is no option, in the simulator, singles and doubles', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    const ids = candidates(view);
    const truths = new Map(ids.map(id => [id, truthOf(view, id)]));
    const classOf = (pick: (truth: Truth) => boolean) => ids.filter(id => pick(truths.get(id)!));

    test.each([
      { counter: 0 },
      { counter: 1 },
      { counter: 2 },
    ])('the options drop exactly the moves the simulator refuses at action count $counter', ({ counter }) => {
      const at = (truth: Truth) => [truth.fresh, truth.once, truth.twice][counter];
      const expected = classOf(truth => at(truth) === 'unoffered' || (counter >= 1 && firstTurnOnly(truth)));
      expect(ids.filter(id => !listed(view, id, counter, false))).toEqual(expected);
    });

    test('the first-turn-only moves are the ones whose handler reads the action count', () => {
      const reads = ids.filter(id => /\bactiveMoveActions\b/.test(String((view.dex.moves.get(id) as { onTry?: unknown }).onTry)));
      expect(classOf(firstTurnOnly)).toEqual(reads);
    });

  });
});

describe('the reported scenes', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    const has = (id: string) => isReal(view, id);

    test.runIf(view.dex.gen >= 3)('Fake Out stays on the first turn out and leaves after it', () => {
      expect(listed(view, 'fakeout', 0, false)).toBe(true);
      expect(listed(view, 'fakeout', 1, false)).toBe(false);
      expect(listed(view, 'fakeout', 5, false)).toBe(false);
    });

    test.runIf(has('fakeout') && outcome(view, 'fakeout', 1, false) === 'refused')('a body whose only move is refused keeps it', () => {
      const own = [mon('Blissey', ['fakeout']), ...(view.doubles ? [mon('Blissey', ['splash', 'tackle'])] : [])];
      const battle = battleIn(view, own, [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      battle.choose('p1', view.doubles ? 'move 1 1, move 1' : 'move 1');
      battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
      const options = searchOptions(rootOf(battle), 'p1');
      expect(listsMove(options, 'fakeout')).toBe(true);
      if (view.doubles) expect(options.some(option => option.choice.split(',')[1]?.trim().startsWith('move tackle'))).toBe(true);
    });

    test.runIf(has('fakeout'))('a Fake Out that failed in the log finds no played option, and the other moves stay', () => {
      const position = rootOf(board(view, 'fakeout', 1, false));
      const played = { kind: 'move' as const, name: 'Fake Out', tera: false, targetLoc: view.doubles ? 1 : null };
      const options = searchOptions(position, 'p1', { keep: view.doubles ? [played, null] : [played] });
      expect(findPlayedOption(options, view.doubles ? [played, null] : [played])).toBeNull();
      expect(listsMove(options, 'splash')).toBe(true);
    });
  });
});
