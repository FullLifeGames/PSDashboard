import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { legalChoices } from '../src/forward/choices';
import { slotChoiceCounts } from '../src/forward/choice-counts';
import { createRootPosition, forkBattle } from '../src/forward/position';
import { searchOptions } from '../src/search/options';
import { applyChoice, resolveForcedSwitches } from '../src/forward/switches';
import { serializeBattleStable } from '../src/forward/serialize';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { Battle, State, Teams, toID, type Side } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { copyOf } from '../src/sim-ask/copy';
import { createRootPosition as createRootPositionFromRevivalBlessing } from '../src/forward-model';

// A Tatsugiri that commands a Dondozo passes its slot; the simulator hands the first choice part to the Dondozo
// (side.js getChoiceIndex skips commanding actives); singles is unaffected: Commander's onUpdate returns in singles.

await loadSimMods('gen9championsou');

const RULES = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', singles: 'gen9customgame', level: 100 },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', singles: 'gen9championscustomgame', level: 50 },
];
const SEED: [number, number, number, number] = [1, 2, 3, 4];
const SIDES = ['p1', 'p2'] as const;
const COMMANDERS: { label: string; commanders: ('p1' | 'p2')[] }[] = [
  { label: 'p1', commanders: ['p1'] },
  { label: 'p2', commanders: ['p2'] },
  { label: 'both sides', commanders: ['p1', 'p2'] },
];
const SLOTS = [{ label: 'a', tatsugiriFirst: true }, { label: 'b', tatsugiriFirst: false }];

describe.each(RULES)('$name: the search offers a choice the simulator accepts for a commanding Tatsugiri', rules => {
  const mon = (species: string, ability: string, moves: string[]): PokemonSet => set(species, moves, { ability, level: rules.level });
  const tatsugiri = mon('Tatsugiri', 'Commander', ['Draco Meteor', 'Muddy Water', 'Icy Wind', 'Protect']);
  const dondozo = mon('Dondozo', 'Unaware', ['Wave Crash', 'Earthquake', 'Order Up', 'Protect']);
  const fillers = [mon('Pikachu', 'Static', ['Thunderbolt', 'Protect']), mon('Snorlax', 'Immunity', ['Body Slam', 'Protect'])];
  const plain = [fillers[0], fillers[1], mon('Rillaboom', 'Grassy Surge', ['Grassy Glide', 'Protect']), mon('Incineroar', 'Intimidate', ['Fake Out', 'Protect'])];
  const team = (tatsugiriFirst: boolean, commands: boolean): PokemonSet[] =>
    commands ? [...(tatsugiriFirst ? [tatsugiri, dondozo] : [dondozo, tatsugiri]), ...fillers] : plain;

  const board = (commanders: ('p1' | 'p2')[], tatsugiriFirst: boolean): Battle =>
    battleOf(rules.format, team(tatsugiriFirst, commanders.includes('p1')), team(tatsugiriFirst, commanders.includes('p2')));

  function rejections(battle: Battle, side: 'p1' | 'p2'): { offered: string[]; rejected: string[] } {
    const position = createRootPosition(serializeBattleStable(battle));
    const offered = legalChoices(position, side).map(option => option.choice);
    const rejected: string[] = [];
    for (const choice of offered) {
      try {
        applyChoice(forkBattle(position, SEED), side, choice);
      } catch (error) {
        rejected.push(`${choice}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { offered, rejected };
  }

  const sideOf = (battle: Battle, side: 'p1' | 'p2') => battle.sides[side === 'p1' ? 0 : 1];

  describe.each(COMMANDERS)('Commander on $label', ({ commanders }) => {
    describe.each(SLOTS)('Tatsugiri in slot $label', ({ tatsugiriFirst }) => {
      const battle = board(commanders, tatsugiriFirst);

      test('every choice legalChoices offers is accepted by the simulator', () => {
        for (const side of SIDES) {
          const commanding = commanders.includes(side);
          const sideState = sideOf(battle, side);
          const tatsugiriSlot = tatsugiriFirst ? 0 : 1;
          expect(!!sideState.active[tatsugiriSlot]?.volatiles['commanding']).toBe(commanding);

          const { offered, rejected } = rejections(battle, side);
          expect(offered.length).toBeGreaterThan(0);
          expect(rejected).toEqual([]);

          const parts = new Set(offered.map(choice => choice.split(',').length));
          expect([...parts]).toEqual([commanding ? 1 : 2]);
          if (!commanding) continue;
          const request = sideState.activeRequest as { active?: { moves: { id?: string }[] }[] } | null;
          const dondozoMoves = new Set((request?.active?.[tatsugiriFirst ? 1 : 0]?.moves ?? []).map(move => move.id));
          expect(dondozoMoves.size).toBeGreaterThan(0);
          const named = offered.filter(choice => choice.startsWith('move ')).map(choice => choice.split(' ')[1]);
          expect(named.length).toBeGreaterThan(0);
          expect(named.every(id => dondozoMoves.has(id))).toBe(true);
        }
      });

      test('a side without Commander keeps the list it has when nobody commands', () => {
        const quiet = board([], tatsugiriFirst);
        for (const side of SIDES.filter(own => !commanders.includes(own))) {
          const withFoeCommanding = legalChoices(createRootPosition(serializeBattleStable(battle)), side).map(option => option.choice);
          const withNoCommander = legalChoices(createRootPosition(serializeBattleStable(quiet)), side).map(option => option.choice);
          expect(withFoeCommanding).toEqual(withNoCommander);
        }
      });
    });
  });

  test('singles: a Tatsugiri keeps its own moves and every choice is accepted', () => {
    const battle = battleOf(rules.singles, [tatsugiri, fillers[0]], [fillers[1], fillers[0]]);
    const sideState = battle.sides[0];
    expect(sideState.active[0]?.volatiles['commanding']).toBeUndefined();
    const { offered, rejected } = rejections(battle, 'p1');
    expect(rejected).toEqual([]);
    expect(offered).toContain('move dracometeor');
  });
});

describe('revival-blessing', () => {
  const createRootPosition = createRootPositionFromRevivalBlessing;
  function makeSet(species: string, moves: string[], level = 100): PokemonSet {
    return {
      name: species, species, item: '', ability: '', moves, nature: 'Hardy', level, gender: '',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    };
  }

  function revivalBattle(doubles: boolean): Battle {
    const p1 = [makeSet('Magikarp', ['Splash'], 1), makeSet('Pawmot', ['Revival Blessing', 'Nuzzle']), makeSet('Snorlax', ['Curse'])];
    const p2 = doubles
      ? [makeSet('Snorlax', ['Body Slam', 'Curse']), makeSet('Blissey', ['Soft-Boiled'])]
      : [makeSet('Snorlax', ['Body Slam', 'Curse'])];
    const battle = new Battle({
      formatid: toID(doubles ? 'gen9doublescustomgame' : 'gen9customgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
    });
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
    if (doubles) {
      battle.choose('p1', 'move splash, move nuzzle 1');
      battle.choose('p2', 'move bodyslam 1, move softboiled');
      battle.choose('p1', 'switch 3, pass');
      battle.choose('p1', 'move curse, move revivalblessing');
      battle.choose('p2', 'move curse, move softboiled');
    } else {
      battle.choose('p1', 'move splash');
      battle.choose('p2', 'move bodyslam');
      battle.choose('p1', 'switch 2');
      battle.choose('p1', 'move revivalblessing');
      battle.choose('p2', 'move curse');
    }
    return battle;
  }

  const magikarp = (battle: Battle) => battle.sides[0].pokemon.find(pokemon => pokemon.species.name === 'Magikarp')!;

  describe('Revival Blessing picks a fainted Pokémon', () => {
    test('singles: the greedy resolution revives the fainted Magikarp instead of sending Snorlax', () => {
      const battle = revivalBattle(false);
      expect(battle.sides[0].requestState).toBe('switch');
      expect(magikarp(battle).fainted).toBe(true);
      expect(() => resolveForcedSwitches(battle, '1,2,3,4')).not.toThrow();
      expect(magikarp(battle).hp).toBeGreaterThan(0);
    });

    test('singles and doubles: the reviving request offers only the fainted party members', () => {
      for (const doubles of [false, true]) {
        const position = createRootPosition(JSON.stringify(State.serializeBattle(revivalBattle(doubles))));
        const labels = legalChoices(position, 'p1').map(option => option.label);
        expect(labels, doubles ? 'doubles' : 'singles').toEqual(['→ Magikarp']);
      }
    });
  });
});

interface CountEntry { label: string; move: string; item?: string }

const COUNT_RULES = [
  { name: 'Generation 6', gen: 6, ruleset: '', gimmicks: false },
  { name: 'Generation 8 without Dynamax', gen: 8, ruleset: '@@@dynamaxclause', gimmicks: false },
  { name: 'Generation 8 with Dynamax', gen: 8, ruleset: '', gimmicks: true },
  { name: 'Generation 9 without Terastallization', gen: 9, ruleset: '@@@terastalclause', gimmicks: false },
  { name: 'Generation 9 with Terastallization', gen: 9, ruleset: '', gimmicks: true },
  { name: 'Champions', gen: 0, ruleset: '', gimmicks: false },
];
const LOCK_HANDLERS = ['onLockMove', 'onDisableMove', 'onFoeDisableMove', 'onTrapPokemon', 'onFoeTrapPokemon'];
const GIMMICKS = ['', ' terastallize', ' mega', ' ultra', ' dynamax', ' zmove'];
const TARGETS = ['', ' 1', ' 2', ' -1', ' -2'];

const formatOf = (gen: number, doubles: boolean, ruleset: string): string => {
  const base = gen === 0 ? 'gen9champions' : `gen${gen}`;
  return `${base}${doubles ? 'doubles' : ''}customgame${ruleset}`;
};

function countEntries(dex: ReturnType<typeof rulesDex>): CountEntry[] {
  const played = (isNonstandard: string | null | undefined): boolean => !isNonstandard || isNonstandard === 'Past';
  const locks = (move: { volatileStatus?: string; self?: { volatileStatus?: string } }): boolean =>
    [move.volatileStatus, move.self?.volatileStatus].some(status => !!status && LOCK_HANDLERS.some(handler => handler in dex.conditions.get(status)));
  const moves = dex.moves.all()
    .filter(move => played(move.isNonstandard) && (move.flags['recharge'] || move.flags['charge'] || move.self?.volatileStatus || locks(move)))
    .map(move => ({ label: move.name, move: move.name }));
  const items = dex.items.all().filter(item => played(item.isNonstandard) && item.isChoice)
    .map(item => ({ label: item.name, move: 'Tackle', item: item.name }));
  return [...moves, ...items];
}

const keyOf = (action: Side['choice']['actions'][number]): string =>
  JSON.stringify({ ...action, pokemon: undefined, order: undefined, target: action.target?.position });

function countsScene(format: string, entry: CountEntry, doubles: boolean, bench: boolean): Battle | null {
  const lead = (moves: string[], fast: boolean) => set('Snorlax', moves, {
    level: 100, item: entry.item ?? '', evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: fast ? 252 : 0 },
  });
  const second = entry.move === 'Tackle' ? 'Splash' : entry.move;
  const filler = set('Snorlax', ['Tackle', 'Splash'], { level: 100 });
  const rest = [...(doubles ? [filler] : []), ...(bench ? [filler, filler] : [])];
  const p1 = [lead(['Tackle', second], true), ...rest];
  const p2 = [lead([entry.move, second === 'Splash' ? 'Splash' : 'Tackle'], false), ...rest];
  const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  for (const id of SIDES) {
    const tries = doubles ? ['move 1, move 2', 'move 1 1, move 2', 'move 1 -2, move 2'] : ['move 1'];
    if (!tries.some(attempt => battle.choose(id, attempt))) return null;
  }
  return !battle.ended && battle.sides.every(side => side.requestState === 'move') ? battle : null;
}

function acceptedActionsUpToTwo(battle: Battle, side: 'p1' | 'p2', slot: number): number {
  const doubles = battle.gameType === 'doubles';
  const copy = copyOf(battle);
  copy.strictChoices = false;
  const own = copy.sides[side === 'p1' ? 0 : 1];
  const moves = [1, 2, 3, 4].flatMap(index => (doubles ? TARGETS : ['']).flatMap(target => GIMMICKS.map(gimmick => `move ${index}${target}${gimmick}`)));
  const parts = [...moves, ...[2, 3, 4, 5, 6].map(index => `switch ${index}`)];
  const passes = own.active.slice(0, slot).some(body => body.fainted || body.volatiles['commanding']);
  const anchor = slot === 0 || passes ? '' : parts.find(part => part.startsWith('move') && own.choose(part) && own.choice.actions.length === 1);
  const seen = new Set<string>();
  for (const part of parts) {
    const accepted = own.choose(anchor ? `${anchor}, ${part}` : part) && own.choice.actions.length === slot + 1;
    if (accepted) seen.add(keyOf(own.choice.actions[slot]));
    own.clearChoice();
    if (seen.size === 2) break;
  }
  return seen.size;
}

describe.each(COUNT_RULES)('$name: slotChoiceCounts equals the actions the simulator accepts', rules => {
  const dex = rulesDex(rules.gen);
  const entries = countEntries(dex);

  test.each([{ type: 'singles', doubles: false }, { type: 'doubles', doubles: true }])('$type: every entry that locks or disables', ({ doubles }) => {
    const wrong: string[] = [];
    let scenes = 0;
    let ones = 0;
    for (const entry of entries) {
      for (const bench of [false, true]) {
        const battle = countsScene(formatOf(rules.gen, doubles, rules.ruleset), entry, doubles, bench);
        if (!battle) continue;
        scenes++;
        const position = createRootPosition(serializeBattleStable(battle));
        for (const id of SIDES) {
          const counts = slotChoiceCounts(position, id);
          for (const slot of doubles ? [0, 1] : [0]) {
            const expected = Math.min(acceptedActionsUpToTwo(battle, id, slot), 2);
            if (counts[slot] !== expected) wrong.push(`${entry.label} ${bench ? 'with a bench' : 'last body'} ${id} slot ${slot}: the simulator accepts ${expected}, read ${counts[slot]}`);
            if (expected === 1) ones++;
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(scenes).toBeGreaterThan(0);
    if (!rules.gimmicks) expect(ones).toBeGreaterThan(0);
  });
});

describe('slotChoiceCounts on the scenes of a line', () => {
  const countsOf = (gen: number, ruleset: string, doubles: boolean, move: string, bench: boolean, side: 'p1' | 'p2' = 'p1'): number[] => {
    const battle = countsScene(formatOf(gen, doubles, ruleset), { label: move, move }, doubles, bench)!;
    return slotChoiceCounts(createRootPosition(serializeBattleStable(battle)), side);
  };

  test('singles: an Encored last body has one choice, with a living bench two', () => {
    expect(countsOf(6, '', false, 'Encore', false)).toEqual([1]);
    expect(countsOf(6, '', false, 'Encore', true)).toEqual([2]);
  });

  test('singles: a body that must recharge has one choice', () => {
    expect(countsOf(6, '', false, 'Giga Impact', false, 'p2')).toEqual([1]);
  });

  test('singles: a field move that fails is dropped from the search options and still counts as a choice', () => {
    const battle = countsScene(formatOf(6, false, ''), { label: 'Stealth Rock', move: 'Stealth Rock' }, false, false)!;
    const position = createRootPosition(serializeBattleStable(battle));
    expect(searchOptions(position, 'p2', { tera: false })).toHaveLength(1);
    expect(slotChoiceCounts(position, 'p2')).toEqual([2]);
  });

  test('singles: an Encored body that may terastallize has two choices, one that may not has one', () => {
    expect(countsOf(9, '', false, 'Encore', false)).toEqual([2]);
    expect(countsOf(9, '@@@terastalclause', false, 'Encore', false)).toEqual([1]);
  });

  test.each([
    { name: 'singles', doubles: false, expected: [1] },
    { name: 'doubles', doubles: true, expected: [1, 2] },
  ])('$name: a body with every move at 0 PP has the one choice Struggle', ({ doubles, expected }) => {
    const battle = countsScene(formatOf(6, doubles, ''), { label: 'Tackle', move: 'Tackle' }, doubles, false)!;
    for (const body of battle.sides[0].active.slice(0, 1)) body.moveSlots.forEach(slot => { slot.pp = 0; });
    battle.makeRequest('move');
    expect(slotChoiceCounts(createRootPosition(serializeBattleStable(battle)), 'p1')).toEqual(expected);
  });

  test('doubles: a slot that charges beside a free partner counts one choice on the held slot only', () => {
    expect(countsOf(6, '', true, 'Solar Beam', false, 'p2')).toEqual([1, 2]);
  });
});
