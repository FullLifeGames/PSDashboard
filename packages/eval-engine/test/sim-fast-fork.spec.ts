import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { afterEach, describe, expect, test } from 'vitest';
import { advancePosition, advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import { forkBattle } from '../src/forward/position';
import { serializeBattleStable } from '../src/forward/serialize';
import { sharedClasses } from '../src/forward/sim-fast/clone';
import { adoptTemplate, copyBattle, setTemplateHook } from '../src/forward/sim-fast/index';
import {
  configureSimFast, resetSimFastForTests, simFastStatus, takeSimFastReport, type SimFastLever,
} from '../src/forward/sim-fast/state';
import { mctsTreeSearch } from '../src/mcts';
import { searchPosition } from '../src/search';
import { loadPositions, ownKeyLists, SEEDS, stableLog, withSimFast, type FixturePosition } from './sim-fast-helpers';

const positions = loadPositions();
const byId = (id: string) => positions.find(position => position.id === id)!;

afterEach(() => {
  setTemplateHook(null);
  resetSimFastForTests();
});

function makeSet(name: string, species: string, moves: string[], level = 50): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(formatid: string, p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID(formatid), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) }, p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));

/** A turn and the next one (first options), as the spec's "weitergespielt" asks for mid-turn states. */
function played(serialized: string, p1: string, p2: string, seed: PRNGSeed, afterFirst?: () => void): string {
  const first = advancePositionWithLog(createRootPosition(serialized), p1, p2, seed);
  afterFirst?.();
  const lines = [first.child.serialized, stableLog(first.log)];
  if (!positionBattle(first.child).ended) {
    const c = legalChoices(first.child, 'p1')[0]?.choice ?? 'wait';
    const d = legalChoices(first.child, 'p2')[0]?.choice ?? 'wait';
    const second = advancePositionWithLog(first.child, c, d, seed);
    lines.push(second.child.serialized, stableLog(second.log));
  }
  return lines.join('\n');
}

interface MidTurnCase {
  name: string;
  serialized: string;
  p1: string;
  p2: string;
  /**
   * Copies in the first advance, exact: the root fork (the root's template is
   * a deserialization), one snapshot for the one resolution round, and one
   * trial per assignment of every side that chooses (two replacements each).
   * The string path makes the root fork only (1).
   */
  firstCopies: number;
  /** A pivot's snapshot still holds the rest of the turn; a double KO's comes after the turn's last action. */
  queued: boolean;
}

function midTurnCases(): MidTurnCase[] {
  const doubleKo = makeBattle('gen9customgame',
    [makeSet('Electrode', 'Electrode', ['Explosion'], 100), makeSet('Chansey', 'Chansey', ['Protect']), makeSet('Blissey', 'Blissey', ['Protect'])],
    [makeSet('Pikachu', 'Pikachu', ['Growl'], 5), makeSet('Eevee', 'Eevee', ['Protect']), makeSet('Snorlax', 'Snorlax', ['Protect'])]);
  const twoSlots = makeBattle('gen9doublescustomgame',
    [makeSet('Electrode', 'Electrode', ['Explosion']), makeSet('Voltorb', 'Voltorb', ['Explosion']),
      makeSet('Chansey', 'Chansey', ['Protect']), makeSet('Blissey', 'Blissey', ['Protect'])],
    [makeSet('Registeel', 'Registeel', ['Protect']), makeSet('Regirock', 'Regirock', ['Protect'])]);
  const pivot = makeBattle('gen9customgame',
    [makeSet('Jolteon', 'Jolteon', ['U-turn'], 100), makeSet('Chansey', 'Chansey', ['Protect']), makeSet('Blissey', 'Blissey', ['Protect'])],
    [makeSet('Snorlax', 'Snorlax', ['Tackle'])]);
  const doublesPivot = makeBattle('gen9doublescustomgame',
    [makeSet('Jolteon', 'Jolteon', ['U-turn'], 100), makeSet('Snorlax', 'Snorlax', ['Tackle']),
      makeSet('Chansey', 'Chansey', ['Protect']), makeSet('Blissey', 'Blissey', ['Protect'])],
    [makeSet('Registeel', 'Registeel', ['Tackle']), makeSet('Regirock', 'Regirock', ['Tackle'])]);
  return [
    { name: 'singles double KO', serialized: serialize(doubleKo), p1: 'move explosion', p2: 'move growl', firstCopies: 6, queued: false },
    { name: 'doubles two open slots', serialized: serialize(twoSlots), p1: 'move explosion, move explosion', p2: 'move protect, move protect', firstCopies: 4, queued: false },
    { name: 'singles U-turn', serialized: serialize(pivot), p1: 'move uturn', p2: 'move tackle', firstCopies: 4, queued: true },
    { name: 'doubles U-turn', serialized: serialize(doublesPivot), p1: 'move uturn 1, move tackle 1', p2: 'move tackle 1, move tackle 1', firstCopies: 4, queued: true },
  ];
}

/**
 * Alakazam (faster, no item) Tricks Snorlax's Leftovers away: takeItem leaves
 * Snorlax an own pendingStaleness holding undefined (pokemon.mjs:1583), which
 * the JSON round trip drops. Snorlax then moves (lastMoveTargetLoc lands after
 * that slot). The second Trick gives the item back: setItem writes
 * pendingStaleness (pokemon.mjs:1599), appended after the newer keys today.
 */
function trickTwiceCases(): { name: string; serialized: string; p1: string; p2: string }[] {
  const snorlax = { ...makeSet('Snorlax', 'Snorlax', ['Tackle']), item: 'Leftovers' };
  const singles = makeBattle('gen9customgame', [makeSet('Alakazam', 'Alakazam', ['Trick'], 100)], [snorlax]);
  const doubles = makeBattle('gen9doublescustomgame',
    [makeSet('Alakazam', 'Alakazam', ['Trick'], 100), makeSet('Chansey', 'Chansey', ['Splash'])],
    [snorlax, makeSet('Blissey', 'Blissey', ['Splash'])]);
  return [
    { name: 'singles', serialized: serialize(singles), p1: 'move trick', p2: 'move tackle' },
    { name: 'doubles', serialized: serialize(doubles), p1: 'move trick 1, move splash', p2: 'move tackle 1, move splash' },
  ];
}

/**
 * Gen 2 calls moveUsed without a target on every move (mods/gen2/scripts.mjs:128),
 * so each mover holds an own lastMoveTargetLoc of undefined (pokemon.mjs:640),
 * a key the Pokemon constructor never creates; the JSON round trip drops it.
 * Mew (faster, no item) steals Snorlax's Leftovers with Thief: pendingStaleness
 * lands after that slot. Mirror Move then copies Snorlax's Rollout, whose
 * onModifyMove writes a defined lastMoveTargetLoc (moves.mjs:15651): today
 * appends it after pendingStaleness, a copy that kept the slot fills it in place.
 */
function gen2MirrorRollout(): string {
  return serialize(makeBattle('gen2customgame', [makeSet('Mew', 'Mew', ['Thief', 'Mirror Move'], 100)],
    [{ ...makeSet('Snorlax', 'Snorlax', ['Rollout']), item: 'Leftovers' }]));
}

describe('forks through templates (lever clone)', () => {
  test('a root: a copy of its template forks as today, every fixture, both seeds', () => {
    for (const position of positions) {
      for (const seed of SEEDS) {
        const today = withSimFast([], () => serializeBattleStable(forkBattle(createRootPosition(position.serialized), seed)));
        const copied = withSimFast(['clone'], () => {
          const text = serializeBattleStable(forkBattle(createRootPosition(position.serialized), seed));
          expect(takeSimFastReport().counters.clones, `${position.id} ${seed}`).toBeGreaterThan(0);
          return text;
        });
        expect(copied, `${position.id} ${seed}`).toBe(today);
      }
    }
  });

  test('a child: two plies play as today, and its forks are copies', () => {
    const plies = (position: FixturePosition, levers: readonly SimFastLever[]) => withSimFast(levers, () => {
      const root = createRootPosition(position.serialized);
      const lines: string[] = [];
      for (const a of legalChoices(root, 'p1').slice(0, 2)) {
        for (const b of legalChoices(root, 'p2').slice(0, 2)) {
          for (const seed of SEEDS) {
            const first = advancePositionWithLog(root, a.choice, b.choice, seed);
            if (!positionBattle(first.child).ended) {
              const c = legalChoices(first.child, 'p1')[0]?.choice ?? 'wait';
              const d = legalChoices(first.child, 'p2')[0]?.choice ?? 'wait';
              const second = advancePositionWithLog(first.child, c, d, seed);
              lines.push(second.child.serialized, stableLog(second.log));
            }
            lines.push(first.child.serialized, stableLog(first.log));
          }
        }
      }
      return { lines, clones: takeSimFastReport().counters.clones };
    });
    for (const position of positions) {
      const copied = plies(position, ['clone']);
      expect(copied.lines, position.id).toEqual(plies(position, []).lines);
      expect(copied.clones, position.id).toBeGreaterThan(0);
    }
  }, 240_000);

  test('a child\'s template is a copy of its live battle, not a deserialization', () => {
    withSimFast(['clone'], () => {
      const root = createRootPosition(positions[0].serialized);
      const child = advancePosition(root, legalChoices(root, 'p1')[0].choice, legalChoices(root, 'p2')[0].choice, SEEDS[0]);
      const original = State.deserializeBattle;
      let deserialized = 0;
      State.deserializeBattle = ((serialized: Parameters<typeof original>[0]) => {
        deserialized++;
        return original.call(State, serialized);
      }) as typeof original;
      try {
        takeSimFastReport();
        forkBattle(child, SEEDS[1]);
        expect(deserialized).toBe(0);
        expect(takeSimFastReport().counters.clones).toBeGreaterThanOrEqual(2);
      } finally {
        State.deserializeBattle = original;
      }
    });
  });

  test('an item taken and given back plays as today (Trick twice, singles and doubles, both seeds)', () => {
    for (const c of trickTwiceCases()) {
      for (const seed of SEEDS) {
        const plies = (levers: readonly SimFastLever[]) => withSimFast(levers, () => {
          const first = advancePositionWithLog(createRootPosition(c.serialized), c.p1, c.p2, seed);
          return advancePositionWithLog(first.child, c.p1, c.p2, seed).child.serialized;
        });
        expect(plies(['clone']), `${c.name} ${seed}`).toBe(plies([]));
      }
    }
  });

  test('a child\'s fork carries the own keys of today\'s fork on every Pokemon, after an item left', () => {
    const keys = (battle: Battle) => battle.sides.map(side => side.pokemon.map(pokemon => Object.keys(pokemon).join()));
    for (const c of trickTwiceCases()) {
      const child = withSimFast(['clone'], () => advancePositionWithLog(createRootPosition(c.serialized), c.p1, c.p2, SEEDS[0]).child);
      const copied = withSimFast(['clone'], () => keys(forkBattle(child, SEEDS[1])));
      expect(copied, c.name).toEqual(withSimFast([], () => keys(forkBattle(child, SEEDS[1]))));
    }
  });

  test('gen 2: an empty lastMoveTargetLoc keeps no slot (Thief, then Mirror Move copies Rollout, both seeds)', () => {
    // Gen 2 has no doubles format (gen2doublescustomgame does not exist); the guard spec's census covers doubles.
    const serialized = gen2MirrorRollout();
    for (const seed of SEEDS) {
      const plies = (levers: readonly SimFastLever[]) => withSimFast(levers, () => {
        const first = advancePositionWithLog(createRootPosition(serialized), 'move thief', 'move rollout', seed);
        return advancePositionWithLog(first.child, 'move mirrormove', 'move rollout', seed).child.serialized;
      });
      expect(plies(['clone']), seed).toBe(plies([]));
      const child = withSimFast(['clone'], () => advancePositionWithLog(createRootPosition(serialized), 'move thief', 'move rollout', seed).child);
      const copied = withSimFast(['clone'], () => ownKeyLists(forkBattle(child, seed)));
      expect(copied, seed).toEqual(withSimFast([], () => ownKeyLists(forkBattle(child, seed))));
    }
  });

  test('a dead active under a stale move request repairs as today (singles and doubles)', () => {
    const singles = makeBattle('gen9customgame',
      [makeSet('Snorlax', 'Snorlax', ['Protect'])],
      [makeSet('Pikachu', 'Pikachu', ['Protect']), makeSet('Eevee', 'Eevee', ['Protect'])]);
    singles.sides[1].active[0]!.hp = 0;
    singles.sides[1].active[0]!.fainted = true;
    const doubles = makeBattle('gen9doublescustomgame',
      [makeSet('Machamp', 'Machamp', ['Karate Chop']), makeSet('Snorlax', 'Snorlax', ['Tackle']), makeSet('Chansey', 'Chansey', ['Protect'])],
      [makeSet('Registeel', 'Registeel', ['Protect']), makeSet('Regirock', 'Regirock', ['Protect'])]);
    doubles.sides[0].active[1]!.hp = 0;
    doubles.sides[0].active[1]!.fainted = true;
    const cases: [string, string, string][] = [
      [serialize(singles), 'move protect', 'move protect'],
      [serialize(doubles), 'move karatechop 1, move protect', 'move protect, move protect'],
    ];
    for (const [serialized, p1, p2] of cases) {
      for (const seed of SEEDS) {
        const child = (levers: readonly SimFastLever[]) => withSimFast(levers, () =>
          advancePosition(createRootPosition(serialized), p1, p2, seed).serialized);
        expect(child(['clone'])).toBe(child([]));
      }
    }
  });

  test('mid-turn: a double KO and a pivot in singles, two open slots and a pivot in doubles, resolve through frozen snapshots and play on as today', () => {
    for (const c of midTurnCases()) {
      for (const seed of SEEDS) {
        const today = withSimFast([], () => played(c.serialized, c.p1, c.p2, seed));
        let firstCopies = -1;
        let queued = false;
        const copied = withSimFast(['clone'], () => {
          // Every template of the run is frozen: the live battle plays on after its snapshot.
          setTemplateHook(battle => {
            queued ||= battle.queue.list.length > 0 || battle.activeMove !== null;
            deepFreeze(battle, sharedClasses(battle), new Set());
          });
          try {
            return played(c.serialized, c.p1, c.p2, seed, () => { firstCopies = takeSimFastReport().counters.clones; });
          } finally {
            setTemplateHook(null);
          }
        });
        expect(firstCopies, `${c.name} ${seed}`).toBe(c.firstCopies);
        expect(queued, `${c.name} ${seed}`).toBe(c.queued);
        expect(copied, `${c.name} ${seed}`).toBe(today);
      }
    }
  });

  test('after a fallback the next fork is today\'s fork', () => {
    const position = positions[0];
    const today = withSimFast([], () => serializeBattleStable(forkBattle(createRootPosition(position.serialized), SEEDS[0])));
    // Unforced on purpose: the break must fall back, not throw (the file's afterEach resets the switch).
    configureSimFast(['clone']);
    const broken = deserializeFromParsed(parseSearchState(position.serialized));
    (broken.sides[0].pokemon[0] as unknown as Record<string, unknown>).foreign = new (class Foreign {})();
    expect(copyBattle(broken)).toBeNull();
    expect(simFastStatus()).toBe('fallback');
    const after = serializeBattleStable(forkBattle(createRootPosition(position.serialized), SEEDS[0]));
    expect(after).toBe(today);
  });

  test('a template whose constructor keys cannot be built steps back to today\'s path; forced, it throws', () => {
    const foreign = () => {
      const battle = deserializeFromParsed(parseSearchState(positions[0].serialized));
      // A prototype the key cache has not seen, whose constructor throws.
      const constructor = function Foreign(): never { throw new Error('no constructor'); };
      Object.setPrototypeOf(battle, Object.create(Object.getPrototypeOf(battle) as object, { constructor: { value: constructor } }) as object);
      return battle;
    };
    configureSimFast(['clone']);
    const battle = foreign();
    expect(adoptTemplate(battle)).toBe(battle);
    expect(simFastStatus()).toBe('fallback');
    expect(copyBattle(battle)).toBeNull();
    resetSimFastForTests();
    configureSimFast(['clone'], { forced: true });
    expect(() => adoptTemplate(foreign())).toThrow(/sim-fast fallback: no constructor/);
  });
});

/**
 * Freezes a template down to the shared dex classes. ActiveMoves carry the
 * DataMove prototype but belong to one battle (Utils.deepClone keeps the
 * prototype), so they and their nested data are frozen too; sets and teams
 * are compared as JSON instead.
 */
function deepFreeze(value: unknown, shared: ReadonlySet<object>, seen: Set<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  const proto = Object.getPrototypeOf(value) as object | null;
  const activeMove = Object.hasOwn(value, 'hit') && (Object.hasOwn(value, 'id') || Object.hasOwn(value, 'move'));
  if (proto !== null && shared.has(proto) && !activeMove) return;
  for (const [key, child] of Object.entries(value)) {
    // Every standard deserialization normalizes the set objects in place (pokemon.mjs:94-150).
    if (key === 'set' || key === 'team') continue;
    deepFreeze(child, shared, seen);
  }
  Object.freeze(value);
}

const SEARCH_LEVERS: readonly (readonly SimFastLever[])[] = [['clone'], ['clone', 'dispatch']];

describe('templates are never written', () => {
  const run = (position: FixturePosition, kind: 'mcts' | 'matrix') => JSON.stringify(kind === 'mcts'
    ? mctsTreeSearch(position.serialized, { depth: 1, samples: 1, tera: false, mode: 'mcts', prove: true }, 0)
    : searchPosition(position.serialized, { depth: 1, samples: 1, tera: false, mode: 'matrix' }));
  const jobs: [string, 'mcts' | 'matrix'][] = [
    ['smogtours-gen9ou-749828#23', 'mcts'], ['gen9vgc2026regi-2629760324#6', 'mcts'], ['smogtours-gen9ou-749351#10', 'matrix'],
  ];

  for (const levers of SEARCH_LEVERS) {
    test(`frozen templates through whole searches, results as today (${levers.join('+')})`, () => {
      for (const [id, kind] of jobs) {
        const position = byId(id);
        const today = withSimFast([], () => run(position, kind));
        const teams: [Battle, string][] = [];
        const frozen = withSimFast(levers, () => {
          setTemplateHook(battle => {
            teams.push([battle, JSON.stringify(battle.sides.map(side => side.team))]);
            deepFreeze(battle, sharedClasses(battle), new Set());
          });
          return run(position, kind);
        });
        expect(frozen, `${id} ${kind}`).toBe(today);
        expect(teams.length, id).toBeGreaterThan(0);
        for (const [battle, before] of teams) expect(JSON.stringify(battle.sides.map(side => side.team))).toBe(before);
      }
    }, 600_000);
  }
});
