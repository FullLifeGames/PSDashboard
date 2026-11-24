import { Battle, State, Teams, toID, type PokemonSet, type PRNGSeed, Dex } from '@pkmn/sim';
import { afterEach, describe, expect, test, beforeEach } from 'vitest';
import { advancePosition, advancePositionWithLog, createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { deserializeFromParsed, parseSearchState, type ParsedSearchState } from '../src/forward/parsed-state';
import { forkBattle } from '../src/forward/position';
import { serializeBattleStable } from '../src/forward/serialize';
import { sharedClasses } from '../src/forward/sim-fast/clone';
import { adoptTemplate, copyBattle, setTemplateHook } from '../src/forward/sim-fast/index';
import {
  configureSimFast,
  resetSimFastForTests,
  simFastStatus,
  takeSimFastReport,
  type SimFastLever,
  parseSimFastSwitch,
  SIM_FAST_DEFAULT,
  breakSimFast,
  simFastCounters,
  simFastOn,
} from '../src/forward/sim-fast/state';
import { mctsTreeSearch } from '../src/mcts';
import { searchPosition } from '../src/search';
import { loadPositions, ownKeyLists, SEEDS, stableLog, withSimFast, type FixturePosition } from './sim-fast-helpers';
import { loadSimMods } from '../src/forward/sim-mods';

describe('sim-fast-fork', () => {
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

  /** A turn and the next one (first options), for mid-turn states. */
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
   * Alakazam (faster, no item) Tricks Snorlax's Leftovers away: takeItem leaves Snorlax an own pendingStaleness holding undefined
   * (pokemon.mjs:1583), which the JSON round trip drops. Snorlax then moves (lastMoveTargetLoc lands after that slot). The second
   * Trick gives the item back: setItem writes pendingStaleness (pokemon.mjs:1599), appended after the newer keys.
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
   * Mew (faster, no item) steals Snorlax's Leftovers with Thief: pendingStaleness lands after that slot. Mirror Move then copies
   * Snorlax's Rollout, whose onModifyMove writes a defined lastMoveTargetLoc (moves.mjs:15651): the JSON round trip appends it
   * after pendingStaleness, a copy that kept the slot fills it in place.
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
});

await loadSimMods('gen9championsou');

describe('sim-fast-champions', () => {

  afterEach(() => resetSimFastForTests());

  const ALL_LEVERS = ['rules', 'clone', 'dispatch'] as const;
  const set = (species: string, item: string, ability: string, moves: string[], nature: string, evs: number[]): PokemonSet => ({
    name: species, species, item, ability, moves, nature, gender: '', level: 50,
    evs: { hp: evs[0], atk: evs[1], def: evs[2], spa: evs[3], spd: evs[4], spe: evs[5] }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });

  function startedBattle(formatid: string, p1: PokemonSet[], p2: PokemonSet[]): string {
    const battle = new Battle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'Alpha', team: p1 }, p2: { name: 'Beta', team: p2 } });
    if (battle.sides.some(side => side.requestState === 'teampreview')) {
      battle.makeChoices(`team ${p1.map((_, i) => i + 1).join('')}`, `team ${p2.map((_, i) => i + 1).join('')}`);
    }
    return serializeBattleStable(battle);
  }

  const CASES = {
    singles: startedBattle('gen9championsou',
      [set('Venusaur', 'Venusaurite', 'Chlorophyll', ['Giga Drain', 'Sludge Bomb', 'Sleep Powder', 'Protect'], 'Modest', [32, 0, 2, 32, 0, 0]),
        set('Jolteon', 'Leftovers', 'Volt Absorb', ['Thunder Wave', 'Thunderbolt', 'Volt Switch', 'Protect'], 'Timid', [2, 0, 0, 32, 0, 32])],
      [set('Garchomp', 'Life Orb', 'Rough Skin', ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Swords Dance'], 'Jolly', [2, 32, 0, 0, 0, 32]),
        set('Corviknight', 'Leftovers', 'Pressure', ['Body Press', 'Roost', 'Iron Defense', 'Brave Bird'], 'Impish', [32, 0, 32, 0, 2, 0])]),
    doubles: startedBattle('gen9championsdoublescustomgame',
      [set('Charizard', 'Charizardite Y', 'Blaze', ['Heat Wave', 'Air Slash', 'Protect', 'Solar Beam'], 'Timid', [2, 0, 0, 32, 0, 32]),
        set('Kingambit', 'Black Glasses', 'Defiant', ['Kowtow Cleave', 'Sucker Punch', 'Protect', 'Iron Head'], 'Adamant', [32, 32, 0, 0, 2, 0]),
        set('Amoonguss', 'Sitrus Berry', 'Regenerator', ['Spore', 'Rage Powder', 'Pollen Puff', 'Protect'], 'Bold', [32, 0, 32, 0, 2, 0])],
      [set('Incineroar', 'Sitrus Berry', 'Intimidate', ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Knock Off'], 'Careful', [32, 2, 0, 0, 32, 0]),
        set('Garchomp', 'Garchompite', 'Rough Skin', ['Rock Slide', 'Earthquake', 'Protect', 'Dragon Claw'], 'Jolly', [2, 32, 0, 0, 0, 32]),
        set('Raichu', 'Focus Sash', 'Lightning Rod', ['Nuzzle', 'Fake Out', 'Thunderbolt', 'Protect'], 'Timid', [2, 0, 0, 32, 0, 32])]),
  };

  /** A choice that Mega Evolves when one is offered, else the first legal choice. */
  function pick(serialized: string, side: 'p1' | 'p2', seedIndex: number): string {
    const choices = legalChoices(createRootPosition(serialized), side).map(choice => choice.choice);
    return choices.find(choice => choice.includes('mega')) ?? choices[seedIndex % Math.max(choices.length, 1)] ?? 'default';
  }

  function played(serialized: string, seed: PRNGSeed, seedIndex: number): string {
    const lines: string[] = [];
    let position = createRootPosition(serialized);
    for (let turn = 0; turn < 2 && !positionBattle(position).ended; turn++) {
      const next = advancePositionWithLog(position, pick(position.serialized, 'p1', seedIndex), pick(position.serialized, 'p2', seedIndex), seed);
      lines.push(next.child.serialized, stableLog(next.log));
      position = next.child;
    }
    return lines.join('\n');
  }

  describe('the speed layer on Champions battles', () => {
    for (const [kind, serialized] of Object.entries(CASES)) {
      test(`two turns under both seeds play as with the layer off (${kind})`, () => {
        SEEDS.forEach((seed, index) => {
          const off = withSimFast([], () => played(serialized, seed, index));
          const on = withSimFast(ALL_LEVERS, () => {
            const result = played(serialized, seed, index);
            expect(takeSimFastReport().counters.dispatchCalls, 'the layer ran').toBeGreaterThan(0);
            return result;
          });
          expect(on, `${kind} ${seed}`).toBe(off);
          expect(off, `${kind} ${seed}: a Mega Evolution played`).toContain('|-mega|');
        });
      });

      test(`a tree search gives the result of the layer off (${kind})`, () => {
        const settings = { depth: 1, samples: 1, tera: false, mode: 'mcts', prove: true, ruleset: 'champions' } as const;
        const off = withSimFast([], () => JSON.stringify(mctsTreeSearch(serialized, settings, 0)));
        const on = withSimFast(ALL_LEVERS, () => {
          const result = JSON.stringify(mctsTreeSearch(serialized, settings, 0));
          expect(takeSimFastReport().counters.clones, 'the layer copied battles').toBeGreaterThan(0);
          return result;
        });
        expect(on).toBe(off);
      }, 600_000);
    }
  });
});

test('the layer runs exactly as the environment says', () => {
  const levers = parseSimFastSwitch(process.env.EVAL_SIM_FAST) ?? SIM_FAST_DEFAULT;
  takeSimFastReport();
  const root = createRootPosition(loadPositions()[0].serialized);
  const [a] = legalChoices(root, 'p1');
  const [b] = legalChoices(root, 'p2');
  advancePositionWithLog(root, a.choice, b.choice, SEEDS[0]);
  advancePositionWithLog(root, a.choice, b.choice, SEEDS[1]);
  const report = takeSimFastReport();
  console.log(`SIM_FAST_PROOF ${process.env.EVAL_SIM_FAST ?? '-'} ${JSON.stringify(report)}`);
  expect(report.status).toBe(levers.length > 0 ? 'active' : 'off');
  expect(report.counters.ruleTables > 0).toBe(levers.includes('rules'));
  expect(report.counters.clones > 0).toBe(levers.includes('clone'));
  expect(report.counters.dispatchAnswered > 0).toBe(levers.includes('dispatch'));
});

describe('sim-fast-rules', () => {
  const positions = loadPositions();
  const firstOf = (format: string) => positions.find(position => position.format === format)!;

  /** The table's content: State.serializeBattle leaves the rule table out (state.mjs:29). */
  function tableOf(battle: Battle) {
    const table = battle.ruleTable;
    return { rules: [...table], valueRules: [...table.valueRules], tagRules: [...table.tagRules] };
  }

  function playedTurns(serialized: string): string[] {
    const root = createRootPosition(serialized);
    const p1 = legalChoices(root, 'p1')[0].choice;
    const p2 = legalChoices(root, 'p2')[0].choice;
    return SEEDS.map(seed => {
      const { child, log } = advancePositionWithLog(root, p1, p2, seed);
      return `${child.serialized}\n${stableLog(log)}`;
    });
  }

  function underLever(on: boolean, parsed: ParsedSearchState, serialized: string) {
    configureSimFast(on ? ['rules'] : []);
    const battle = deserializeFromParsed(parsed);
    return { state: serializeBattleStable(battle), table: tableOf(battle), turns: playedTurns(serialized) };
  }

  // The sim never stores its table (the ruleset repeals a rule); another spec file of this worker may have left one on the
  // shared format.
  beforeEach(() => { Dex.formats.get('gen9ou', true).ruleTable = null; });
  afterEach(() => resetSimFastForTests());

  describe('lever rules: one rule table per format', () => {
    test('gen9ou builds its table once and every battle shares it', () => {
      const parsed = parseSearchState(firstOf('gen9ou').serialized);
      configureSimFast(['rules']);
      const a = deserializeFromParsed(parsed);
      const b = deserializeFromParsed(parsed);
      expect(a.ruleTable).toBe(b.ruleTable);
      expect(Dex.formats.get('gen9ou', true).ruleTable).toBe(a.ruleTable);
      expect(takeSimFastReport().counters.ruleTables).toBe(2);
    });

    test('gen9doublesou keeps the table the sim stores itself', () => {
      const format = Dex.formats.get('gen9doublesou', true);
      const stored = Dex.forFormat(format).formats.getRuleTable(format);
      configureSimFast(['rules']);
      expect(deserializeFromParsed(parseSearchState(firstOf('gen9doublesou').serialized)).ruleTable).toBe(stored);
    });

    test('the lever off restores today: gen9ou builds a table per battle again', () => {
      const parsed = parseSearchState(firstOf('gen9ou').serialized);
      configureSimFast(['rules']);
      deserializeFromParsed(parsed);
      configureSimFast([]);
      expect(Dex.formats.get('gen9ou', true).ruleTable).toBeNull();
      expect(deserializeFromParsed(parsed).ruleTable).not.toBe(deserializeFromParsed(parsed).ruleTable);
    });

    test('a kept table changes no battle: every fixture gives the same state, the same rule table and the same played turns', () => {
      for (const position of positions) {
        const parsed = parseSearchState(position.serialized);
        const off = underLever(false, parsed, position.serialized);
        const on = underLever(true, parsed, position.serialized);
        expect(on.state, `${position.id} state`).toBe(off.state);
        expect(on.table, `${position.id} rule table`).toEqual(off.table);
        expect(on.turns, `${position.id} played turns`).toEqual(off.turns);
      }
    });
  });
});

describe('sim-fast-state', () => {
  afterEach(() => resetSimFastForTests());

  function withEnvironment(value: string | undefined, run: () => void): void {
    const saved = process.env.EVAL_SIM_FAST;
    if (value === undefined) delete process.env.EVAL_SIM_FAST;
    else process.env.EVAL_SIM_FAST = value;
    try {
      resetSimFastForTests();
      run();
    } finally {
      if (saved === undefined) delete process.env.EVAL_SIM_FAST;
      else process.env.EVAL_SIM_FAST = saved;
      resetSimFastForTests();
    }
  }

  describe('the switch', () => {
    test('reads 0, 1 and lever lists; an empty value means the default', () => {
      expect(parseSimFastSwitch(undefined)).toBeNull();
      expect(parseSimFastSwitch(' ')).toBeNull();
      expect(parseSimFastSwitch('0')).toEqual([]);
      expect(parseSimFastSwitch('1')).toEqual(['rules', 'clone', 'dispatch']);
      expect(parseSimFastSwitch('dispatch, rules')).toEqual(['rules', 'dispatch']);
      expect(() => parseSimFastSwitch('clone,turbo')).toThrow(/unknown lever "turbo"/);
    });

    test('a configured list turns exactly those levers on', () => {
      configureSimFast(['clone']);
      expect([simFastOn('rules'), simFastOn('clone'), simFastOn('dispatch')]).toEqual([false, true, false]);
      expect(simFastStatus()).toBe('active');
      configureSimFast([]);
      expect(simFastStatus()).toBe('off');
    });

    test('under Node a set variable decides and forces', () => {
      withEnvironment('dispatch', () => {
        expect(simFastOn('dispatch')).toBe(true);
        expect(simFastOn('clone')).toBe(false);
        expect(() => breakSimFast('fallback', 'probe')).toThrow(/sim-fast fallback: probe/);
      });
    });

    test('under Node without the variable the default holds and nothing is forced', () => {
      withEnvironment(undefined, () => {
        expect(simFastStatus()).toBe(SIM_FAST_DEFAULT.length > 0 ? 'active' : 'off');
        expect(() => breakSimFast('fallback', 'probe')).not.toThrow();
        expect(simFastStatus()).toBe('fallback');
      });
    });
  });

  describe('status and counters', () => {
    test('a report carries the counters since the last report', () => {
      configureSimFast(['clone']);
      simFastCounters.clones += 3;
      expect(takeSimFastReport()).toEqual({
        status: 'active', counters: { ruleTables: 0, clones: 3, dispatchCalls: 0, dispatchAnswered: 0, fallbacks: 0 },
      });
      expect(takeSimFastReport().counters.clones).toBe(0);
    });

    test('a break turns every lever off and outlives what the host configures next', () => {
      configureSimFast(['rules', 'clone', 'dispatch']);
      breakSimFast('fallback', 'probe');
      expect(simFastStatus()).toBe('fallback');
      expect(simFastOn('clone')).toBe(false);
      configureSimFast(['clone']);
      expect(simFastOn('clone')).toBe(false);
      expect(takeSimFastReport().counters.fallbacks).toBe(1);
    });

    test('forced mode throws instead of falling back', () => {
      configureSimFast(['clone'], { forced: true });
      expect(() => breakSimFast('hash-mismatch', 'Battle.runEvent')).toThrow(/sim-fast hash-mismatch: Battle.runEvent/);
      expect(simFastStatus()).toBe('active');
    });
  });
});
