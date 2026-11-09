import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { rulesDex } from '@fulllifegames/replay-core';
import { buildForcedSwitchChoice } from '../src/branch/corrections';
import { forcedAnswersOf, revivingSlots } from '../src/branch/forced-request';
import { collectForcedSwitchSpecies, parseTurnBlocks } from '../src/branch/protocol-choices';
import { forceSwitches } from '../src/branch/forced-slots';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, sweepMoves, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { sweepSelection } from './dice-fixtures';

/**
 * Round 89 (#131, #144): the forced answers read the log's slot and the log's revive line.
 *
 * The rows: `collectForcedSwitchSpecies` on written lines (a revive line is an entry of its own; the replacements of one request come in
 * slot order, with the slot each entry names beside the list). Then two sweeps over the rule sets the corpus plays (Gens 1 to 9 and the
 * Champions mod), singles and doubles:
 *   1. every Dex move with a `slotCondition`, played on a board with two fainted bench bodies: exactly the moves whose request carries
 *      `reviving` write a `-heal ... [from] move:` line on a fainted body; the log's second fainted body is the one the answer names, and
 *      `buildForcedSwitchChoice` sends the slot of that body (the simulator's own `default` would revive the first);
 *   2. doubles: both foes fall, the log writes the replacement of slot b before slot a (the faster body first), and the answer built
 *      from that log puts each body on the slot the log names, in both orders of the sides; the ability sweep finds the abilities whose
 *      switch-in output depends on the slot (Imposter) and plays the answer built from the log: the same lines come out.
 */
await loadSimMods('gen9championsou');

const DEX = rulesDex(9);
const simOf = (battle: Battle): SimBattle => battle as unknown as SimBattle;

describe('the forced list: slots and revives', () => {
  const heal = (side: string, name: string, from = 'Revival Blessing') => `|-heal|${side}: ${name}|49/100|[from] move: ${from}`;

  test('a revive line is an entry of its own, with no slot; the log orders the entries', () => {
    const lines = [
      '|move|p1a: Pawmot|Revival Blessing|p1a: Pawmot', heal('p1', 'Samurott'),
      '|move|p2a: Gliscor|U-turn|p1a: Pawmot', '|switch|p2a: Tinkaton|Tinkaton, F|100/100',
    ];
    const list = collectForcedSwitchSpecies(lines, [], 'p1', DEX);
    expect(list).toEqual(['Samurott']);
    expect(forcedAnswersOf(list)).toEqual([{ slot: null, revive: true, request: 0 }]);
    // the other side has its own entries only
    expect(collectForcedSwitchSpecies(lines, [], 'p2', DEX)).toEqual(['Tinkaton']);
  });

  test('a heal of an active body, or by an item, is no revive', () => {
    const lines = [
      '|-heal|p1a: Pawmot|49/100|[from] move: Wish|[wisher] Pawmot', '|-heal|p1: Pawmot|100/100|[from] item: Leftovers',
      '|-heal|p1b: Blissey|60/100|[from] move: Recover',
    ];
    expect(collectForcedSwitchSpecies(lines, [], 'p1', DEX)).toEqual([]);
  });

  test('doubles: the replacements after the upkeep come in slot order, each entry with its slot', () => {
    const post = ['|switch|p2b: Miraidon|Miraidon, L50|100/100', '|switch|p2a: Ditto|Ditto, L50|100/100'];
    const list = collectForcedSwitchSpecies([], post, 'p2', DEX);
    expect(list).toEqual(['Ditto', 'Miraidon']);
    expect(forcedAnswersOf(list)?.map(answer => answer.slot)).toEqual([0, 1]);
  });

  test('a slot that repeats starts the next request; the requests keep their order', () => {
    const post = ['|switch|p1b: Rotom|Rotom', '|switch|p1a: Heatran|Heatran', '|switch|p1a: Gengar|Gengar'];
    const list = collectForcedSwitchSpecies([], post, 'p1', DEX);
    expect(list).toEqual(['Heatran', 'Rotom', 'Gengar']);
    expect(forcedAnswersOf(list)?.map(answer => answer.slot)).toEqual([0, 1, 0]);
  });

  test('before the upkeep each request is one entry, in the log order', () => {
    const pre = [
      '|move|p1a: Scizor|U-turn|p2a: Snorlax', '|switch|p1a: Heatran|Heatran|100/100[from] U-turn',
    ];
    expect(forcedAnswersOf(collectForcedSwitchSpecies(pre, [], 'p1', DEX))?.map(answer => answer.slot)).toEqual([0]);
  });

  test('an array another module made has no record and reads as before', () => {
    expect(forcedAnswersOf(['Ditto'])).toBeUndefined();
  });
});

// ---------- the revive sweep ----------

/** The public half of the simulator's log: the third line of each `|split|` triple. */
function publicLog(battle: Battle): string[] {
  const out: string[] = [];
  for (let index = 0; index < battle.log.length; index++) {
    if (battle.log[index].startsWith('|split|')) { out.push(battle.log[index + 2]); index += 2; } else out.push(battle.log[index]);
  }
  return out;
}

/** The log with its turns, as `parseTurnBlocks` reads a replay: closed by a turn line so the last block is kept. */
const blocksOf = (battle: Battle) => {
  const lines = publicLog(battle);
  if (!/^\|turn\|/.test(lines[lines.length - 1])) lines.push(`|turn|${battle.turn + 1}`);
  return parseTurnBlocks(lines.join('\n')).turns;
};

const AIMED = new Set(['normal', 'any', 'adjacentFoe']);
const ALLY = new Set(['adjacentAlly', 'adjacentAllyOrSelf']);

interface ReviveBoard { battle: Battle; party: string[]; click: string }

/**
 * Snorlax with the move leads p1; the bench holds two fainted bodies and one living body (a fifth body in doubles, where two bodies lead).
 * The foes splash. Returns the board before the move is clicked.
 */
function reviveBoard(rules: Rules, mode: Mode, move: DexMove): ReviveBoard {
  const body = (species: string, moves: string[]) => mon(rules, { species, moves, gender: 'M' });
  const user = body('Snorlax', [move.id, 'splash']);
  const rest = mode === 'singles'
    ? ['Blissey', 'Chansey', 'Pikachu'] : ['Blissey', 'Chansey', 'Pikachu', 'Raichu'];
  const p1 = [user, ...rest.map(species => body(species, ['splash']))];
  const foes = mode === 'singles' ? [body('Vaporeon', ['splash'])] : [body('Vaporeon', ['splash']), body('Vaporeon', ['splash'])];
  const battle = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, foes);
  const side = battle.sides[0];
  // two fainted bodies on the bench, the first and the last of the bench; the living one stays between them
  const bench = side.pokemon.slice(side.active.length);
  const fainted = [bench[0], bench[bench.length - 1]];
  for (const pokemon of fainted) { pokemon.hp = 0; pokemon.faint(); }
  battle.resolveFaints();
  const aim = AIMED.has(move.target) ? ' 1' : ALLY.has(move.target) ? ' -2' : '';
  return { battle, party: side.pokemon.map(pokemon => pokemon.name), click: mode === 'singles' ? 'move 1' : `move 1${aim}, move 1` };
}

const foeClick = (mode: Mode) => (mode === 'singles' ? 'move 1' : 'move 1, move 1');

/** One turn of the board: both sides click; a p1 request that revives takes `target` (1-based party slot) when given. Returns whether the request revived. */
function playTurn(board: ReviveBoard, mode: Mode, target?: number): { revived: boolean; answer: string | null } {
  const { battle } = board;
  expect(battle.choose('p1', board.click)).toBe(true);
  expect(battle.choose('p2', foeClick(mode))).toBe(true);
  let revived = false;
  let answer: string | null = null;
  for (let guard = 0; guard < 4 && !battle.ended; guard++) {
    const pending = battle.sides.filter(side => side.requestState === 'switch' && !side.isChoiceDone());
    if (pending.length === 0) break;
    for (const side of pending) {
      const reviving = revivingSlots(simOf(battle), side.n);
      if (side.n === 0 && reviving.some(Boolean) && target !== undefined) {
        revived = true;
        const needs = forceSwitches(simOf(battle), 0);
        answer = needs.map((need) => (need ? `switch ${target}` : 'pass')).join(', ');
        expect(battle.choose('p1', answer), `${answer}: ${side.choice.error}`).toBe(true);
      } else {
        revived ||= reviving.some(Boolean);
        battle.choose(side.id, 'default');
      }
    }
  }
  return { revived, answer };
}

/** The request of the board's turn, stopped where the revive prompt is open (no answer given). */
function stopAtPrompt(board: ReviveBoard, mode: Mode): boolean {
  const { battle } = board;
  battle.choose('p1', board.click);
  battle.choose('p2', foeClick(mode));
  return revivingSlots(simOf(battle), 0).some(Boolean);
}

describe('the revive answer, every Dex move with a slot condition (#131)', () => {
  for (const { rules, mode, name } of SWEEP_CASES) {
    test(name, () => {
      const { moves } = sweepMoves(rules, move => !!move.slotCondition, false);
      if (rules.generation >= 3) expect(moves.length, 'the rule set has moves with a slot condition').toBeGreaterThan(0);
      let revivers = 0;
      for (const move of moves) {
        const board = reviveBoard(rules, mode, move);
        const lastSlot = board.party.length;
        const { revived, answer } = playTurn(board, mode, lastSlot);
        const dex = dexOfRules(rules);
        const lists = blocksOf(board.battle).map(block => collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p1', dex));
        const entries = lists.flatMap(list => forcedAnswersOf(list)?.filter(entry => entry.revive) ?? []);
        const benchHeals = publicLog(board.battle).filter(line => /^\|-heal\|p1: [^|]+\|[^|]*\|\[from\] move: /.test(line));
        expect(entries.length > 0, `${name} ${move.id}: a revive entry iff the request carried reviving`).toBe(revived);
        expect(benchHeals.length > 0, `${name} ${move.id}: a heal line on a bench body iff the request carried reviving`).toBe(revived);
        if (!revived) continue;
        revivers++;
        // the log names the last body of the party, the second of the two fainted ones
        expect(benchHeals[0]).toContain(`p1: ${board.party[lastSlot - 1]}|`);
        const list = lists.find(entry => forcedAnswersOf(entry)?.some(item => item.revive))!;
        expect(list).toEqual([board.party[lastSlot - 1]]);
        // the answer of the forced answers, from the log, on a board stopped at the prompt
        const fresh = reviveBoard(rules, mode, move);
        expect(stopAtPrompt(fresh, mode)).toBe(true);
        expect(buildForcedSwitchChoice(simOf(fresh.battle), 0, list, { current: 0 })).toBe(answer);
        // without the log's line the answer is the body the simulator's own `default` revives (the first fainted one), never a living body
        const blind = reviveBoard(rules, mode, move);
        stopAtPrompt(blind, mode);
        const first = blind.battle.sides[0].active.length + 1;
        const shape = forceSwitches(simOf(blind.battle), 0).map(need => (need ? `switch ${first}` : 'pass')).join(', ');
        expect(buildForcedSwitchChoice(simOf(blind.battle), 0, [], { current: 0 })).toBe(shape);
      }
      // Revival Blessing exists from Gen 9 on; every older rule set finds none, and says so
      expect(revivers > 0).toBe(rules.generation === 9);
    }, 120_000);
  }
});

describe('a replacement request is not a revive request', () => {
  test('singles: a revive line in the list is dropped by a replacement request, which takes the next switch', () => {
    const rules = RULES[8];
    const body = (species: string, moves: string[]) => mon(rules, { species, moves, gender: 'M' });
    const battle = battleOf(rules.singles, [body('Snorlax', ['splash']), body('Chansey', ['splash']), body('Pikachu', ['splash'])], [body('Vaporeon', ['surf'])]);
    battle.sides[0].active[0].hp = 1;
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    expect(battle.sides[0].requestState).toBe('switch');
    expect(revivingSlots(simOf(battle), 0)).toEqual([false]);
    // the revive line of an earlier request that the rebuild never asked (it drifted), then the replacement the log sends
    const list = collectForcedSwitchSpecies(['|-heal|p1: Pikachu|49/100|[from] move: Revival Blessing'], ['|switch|p1a: Chansey|Chansey, F|100/100'], 'p1', DEX);
    expect(list).toEqual(['Pikachu', 'Chansey']);
    const cursor = { current: 0 };
    expect(buildForcedSwitchChoice(simOf(battle), 0, list, cursor)).toBe('switch 2');
    expect(cursor.current).toBe(2);
  });
});

// ---------- the slot sweep ----------

interface SlotBoard { battle: Battle; holder: string }

/**
 * Doubles. p1 Snorlax (Earthquake) and Blissey lead against Snorlax (slot a, slow) and Pikachu (slot b, fast), both at 1 HP: the Earthquake
 * knocks out both, and the log writes the faster body's replacement (slot b) first. The bench of p2 is the holder, a Vaporeon and a Raichu.
 */
function slotBoard(rules: Rules, ability: string): SlotBoard {
  const body = (species: string, moves: string[], extra: Record<string, string> = {}) => ({ ...mon(rules, { species, moves, gender: 'M' }), ...extra });
  const p1 = [body('Snorlax', ['earthquake']), body('Blissey', ['splash'])];
  const p2 = [
    body('Snorlax', ['splash']), body('Pikachu', ['splash']),
    body('Dragonite', ['splash'], { ability }), body('Vaporeon', ['splash']), body('Raichu', ['splash']),
  ];
  const battle = battleOf(rules.doubles!, p1, p2);
  for (const pokemon of battle.sides[1].active) pokemon.hp = 1;
  battle.choose('p1', 'move 1, move 1');
  battle.choose('p2', 'move 1, move 1');
  return { battle, holder: 'Dragonite' };
}

/** The slot-ordered answers for the holder in slot `a` or `b`, the Vaporeon in the other. */
const ORDERS = { 'holder in a': 'switch 3, switch 4', 'holder in b': 'switch 4, switch 3' } as const;

/** The lines the replacements wrote, with the slot letters of the sides removed: what each body did on entering, however the slots were filled. */
const enteringLines = (battle: Battle): string[] => {
  const lines = publicLog(battle);
  const from = lines.findIndex(line => /^\|switch\|p2[ab]: (Dragonite|Vaporeon)/.test(line));
  return lines.slice(from).filter(line => line !== '|' && !/^\|(t:|turn|upkeep)(\||$)/.test(line)).map(line => line.replace(/\|(p[12])[ab]:/g, '|$1:'));
};

function slotCase(rules: Rules, ability: string, order: keyof typeof ORDERS): void {
  const ref = slotBoard(rules, ability);
  expect(ref.battle.sides[1].requestState).toBe('switch');
  expect(forceSwitches(simOf(ref.battle), 1)).toEqual([true, true]);
  expect(ref.battle.choose('p2', ORDERS[order]), `${ORDERS[order]}: ${ref.battle.sides[1].choice.error}`).toBe(true);
  const block = blocksOf(ref.battle).find(entry => entry.postUpkeep.some(line => line.startsWith('|switch|p2')))!;
  const switches = [...block.preUpkeep, ...block.postUpkeep].filter(line => line.startsWith('|switch|p2'));
  expect(switches.length).toBe(2);
  const list = collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p2', dexOfRules(rules));
  expect(list.length).toBe(2);
  const fresh = slotBoard(rules, ability);
  const choice = buildForcedSwitchChoice(simOf(fresh.battle), 1, list, { current: 0 });
  expect(choice, `${rules.name} ${ability} ${order}: the answer names each body's slot`).toBe(ORDERS[order]);
  expect(fresh.battle.choose('p2', choice!)).toBe(true);
  expect(enteringLines(fresh.battle)).toEqual(enteringLines(ref.battle));
}

describe('a forced replacement enters the slot the log names (#144)', () => {
  // Gens 3 and 4 ask one slot per request (the simulator replaces a fainted body before the next action), so they have no pair to order.
  for (const rules of RULES.filter(entry => entry.doubles && entry.generation >= 5)) {
    test(`${rules.name}: both orders of the two bodies`, () => {
      for (const order of Object.keys(ORDERS) as (keyof typeof ORDERS)[]) slotCase(rules, 'noability', order);
    });
  }

  test('the log writes the faster body first, and the list puts the slots in order', () => {
    const ref = slotBoard(RULES[8], 'noability');
    ref.battle.choose('p2', ORDERS['holder in a']);
    const switches = publicLog(ref.battle).filter(line => line.startsWith('|switch|p2'));
    expect(switches.map(line => line.split('|')[2].slice(0, 3)).slice(2)).toEqual(['p2b', 'p2a']);
    const block = blocksOf(ref.battle).find(entry => entry.postUpkeep.length > 0)!;
    const list = collectForcedSwitchSpecies(block.preUpkeep, block.postUpkeep, 'p2', DEX);
    expect(list).toEqual(['Dragonite', 'Vaporeon']);
  });

  test('the log leaves one slot empty: the other slot takes a different body', () => {
    for (const rules of RULES.filter(entry => entry.doubles && entry.generation >= 5)) {
      for (const slot of [0, 1]) {
        const fresh = slotBoard(rules, 'noability');
        // a log that names slot `slot` only; the rebuild asks for both
        const line = `|switch|p2${'ab'[slot]}: Vaporeon|Vaporeon, M|100/100`;
        const choice = buildForcedSwitchChoice(simOf(fresh.battle), 1, collectForcedSwitchSpecies([], [line], 'p2', DEX), { current: 0 })!;
        const slots = choice.split(', ').map(part => part.replace('switch ', ''));
        expect(slots[slot], `${rules.name}: the logged body goes to its slot`).toBe('4');
        expect(new Set(slots).size, `${rules.name}: ${choice}`).toBe(2);
        expect(fresh.battle.choose('p2', choice), `${rules.name}: ${choice}`).toBe(true);
      }
    }
  });

  test('a plain list reads in log order, and the fallback skips the body another slot took', () => {
    const fresh = slotBoard(RULES[8], 'noability');
    expect(buildForcedSwitchChoice(simOf(fresh.battle), 1, ['Vaporeon', 'Dragonite'], { current: 0 })).toBe('switch 4, switch 3');
    expect(buildForcedSwitchChoice(simOf(fresh.battle), 1, ['Dragonite'], { current: 0 })).toBe('switch 3, switch 4');
    expect(buildForcedSwitchChoice(simOf(fresh.battle), 1, [], { current: 0 })).toBe('switch 3, switch 4');
  });
});

describe('the abilities whose switch-in depends on the slot (#144)', () => {
  test.each(RULES.filter(entry => entry.doubles && entry.generation >= 5).map(entry => [entry.name, entry] as const))('%s', (_, rules) => {
    const dex = dexOfRules(rules);
    const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && (ability.isNonstandard === null || ability.isNonstandard === undefined));
    const sample = new Set(sweepSelection(abilities, 'moves').map(ability => ability.id));
    if (dex.abilities.get('imposter').exists) sample.add('imposter');
    const dependent: string[] = [];
    for (const id of sample) {
      const [inA, inB] = (Object.keys(ORDERS) as (keyof typeof ORDERS)[]).map(order => {
        const board = slotBoard(rules, id);
        board.battle.choose('p2', ORDERS[order]);
        return enteringLines(board.battle).filter(line => !/^\|switch\|/.test(line)).join('\n');
      });
      if (inA !== inB) dependent.push(id);
      for (const order of Object.keys(ORDERS) as (keyof typeof ORDERS)[]) slotCase(rules, id, order);
    }
    // the sweep finds Imposter: the holder copies the foe in front of it
    expect(dependent).toContain('imposter');
  }, 300_000);
});
