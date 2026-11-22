import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { State, type Battle, type Pokemon } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { endgameKey } from '../src/endgame/key';
import { AIM_KEY, BOOKKEEPING_FIELDS, BOOKKEEPING_KEYS, boardFacts, ROLL_FIELDS, STRIPPED_FIELDS } from '../src/endgame/board-facts';
import { CHAMPIONS, mon, playClicks, RULES, type Mode } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, sweepBoard, sweepClicks, sweepMoves } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#145, step A6-0): the board facts. Two draws of one cell are the same board when they differ only by what the dice of
 * the roll decide (the damage, the crit, the hit count) or by the turn's own bookkeeping. The prover (A6-2) reads this to tell which
 * chance dice of a cell moved the board and which only moved a number. The facts are the memo key's state (`endgame/key.ts`) without
 * the roll fields and the bookkeeping, and nothing reads them yet: this step holds the rule against the simulator.
 *
 * What the rows hold:
 *  1. The roll fields and the nominal aim of a move that takes no chosen target leave the facts alone; in doubles, in every rule set
 *     the corpus plays (Gens 3 to 9 and the Champions mod), and in singles for the roll fields.
 *  2. PP, a status counter, a volatile, a boost, the item, the ability, the field's duration, the weather and a body's HP outside the
 *     roll fields each move the facts. So does the aim of a move that takes a chosen target (a lock re-aims on it).
 *  3. A source scan of the installed @pkmn/sim and @pkmn/mods builds: every read of a dropped bookkeeping key is one of the reads
 *     pinned below, each inside the turn that wrote the key (the simulator resets the flags at the end of the turn).
 */
await loadSimMods('gen9championsou');

const DOUBLES = SWEEP_CASES.filter(entry => entry.mode === 'doubles');
const bodiesOf = (battle: Battle): Pokemon[] => battle.sides.flatMap(side => side.pokemon);

/** One turn of a sweep board: the attacker uses the move, everyone else splashes. */
function turnOf(rules: (typeof RULES)[number], moveId: string, mode: Mode, seed: string): Battle {
  const board = sweepBoard(rules, moveId, mode, seed);
  const target = dexOfRules(rules).moves.get(moveId).target;
  playClicks(board, sweepClicks(mode, target));
  return board;
}

/** The target types a click does not choose (the simulator's own list: `battle.actions.targetTypeChoices`). */
const unchosen = (battle: Battle, moveId: string): boolean => !battle.actions.targetTypeChoices(battle.dex.moves.get(moveId).target);

describe('the facts leave the roll fields and a nominal aim alone', () => {
  test('the memo key drops what the facts drop (the key keeps one field more: the Gen 2 and 3 start-of-turn roll)', () => {
    const board = turnOf(RULES[8], 'tackle', 'singles', '1,2,3,4');
    const state = State.serializeBattle(board) as unknown as Record<string, unknown>;
    const key = JSON.parse(endgameKey(board)) as Record<string, unknown>;
    for (const field of STRIPPED_FIELDS) {
      if (field === 'quickClawRoll') continue;
      expect(field in state, `${field} is in the serialized battle`).toBe(true);
      expect(field in key, `${field} is in the memo key`).toBe(false);
    }
  });

  describe.each(SWEEP_CASES)('roll fields, $name', ({ rules, mode }) => {
    test('a body\'s HP, the last damage and the move\'s total damage change nothing', () => {
      const a = turnOf(rules, 'tackle', mode, '1,2,3,4');
      const b = turnOf(rules, 'tackle', mode, '1,2,3,4');
      expect(boardFacts(a)).toBe(boardFacts(b));
      for (const body of bodiesOf(b)) {
        body.hp = Math.max(1, body.hp - 7);
        body.lastDamage += 3;
        body.hurtThisTurn = 5;
      }
      const last = b.sides[0].active[0].lastMove as unknown as { totalDamage?: number } | null;
      if (last) last.totalDamage = (last.totalDamage ?? 0) + 11;
      expect(boardFacts(b)).toBe(boardFacts(a));
    });

    test('a move\'s critical hit (the hit data of the finished move) changes nothing', () => {
      const a = turnOf(rules, 'tackle', mode, '1,2,3,4');
      const b = turnOf(rules, 'tackle', mode, '1,2,3,4');
      const hits = (b.sides[0].active[0].lastMove as unknown as { moveHitData?: Record<string, { crit: boolean }> } | null)?.moveHitData;
      if (hits) for (const hit of Object.values(hits)) hit.crit = !hit.crit;
      expect(boardFacts(b)).toBe(boardFacts(a));
    });
  });

  describe.each(DOUBLES)('the nominal aim, $name', ({ rules, mode }) => {
    const { moves } = sweepMoves(rules, move => move.category !== 'Status' && (move.target === 'allAdjacentFoes' || move.target === 'allAdjacent'));
    test('a sample of spread moves is in the sweep', () => expect(moves.length).toBeGreaterThan(0));
    test.each(moves.map(move => move.id))('%s: another nominal target is the same board', moveId => {
      const a = turnOf(rules, moveId, mode, '1,2,3,4');
      const b = turnOf(rules, moveId, mode, '1,2,3,4');
      const user = b.sides[0].active[0];
      expect(unchosen(b, moveId)).toBe(true);
      if (!user.fainted) expect(user.lastMove?.id).toBe(moveId);
      user.lastMoveTargetLoc = user.lastMoveTargetLoc === 1 ? 2 : 1;
      expect(boardFacts(b)).toBe(boardFacts(a));
    });

    test('the dice choose the nominal target: two seeds of one spread move leave two different aims', () => {
      const aims = new Set<number>();
      for (let seed = 1; seed <= 24 && aims.size < 2; seed++) aims.add(turnOf(rules, 'earthquake', mode, `${seed},2,3,4`).sides[0].active[0].lastMoveTargetLoc);
      expect(aims.size).toBeGreaterThan(1);
    });
  });

  describe.each(DOUBLES)('a chosen target stays a fact, $name', ({ rules, mode }) => {
    test('the aim of a move that takes a chosen target moves the facts', () => {
      const a = turnOf(rules, 'tackle', mode, '1,2,3,4');
      const b = turnOf(rules, 'tackle', mode, '1,2,3,4');
      const user = b.sides[0].active[0];
      expect(unchosen(b, 'tackle')).toBe(false);
      user.lastMoveTargetLoc = user.lastMoveTargetLoc === 1 ? 2 : 1;
      expect(boardFacts(b)).not.toBe(boardFacts(a));
    });
  });
});

describe.each([RULES[8], CHAMPIONS])('what the facts keep, $name', rules => {
  const board = (): Battle => battleOf(rules.singles, [mon(rules, { species: 'Snorlax', moves: ['tackle', 'splash'], gender: 'M' })], [mon(rules, { species: 'Vaporeon', moves: ['splash'] })]);
  const moved: [string, (battle: Battle) => void][] = [
    ['PP', battle => { battle.sides[0].active[0].moveSlots[0].pp -= 1; }],
    ['a status', battle => { battle.sides[1].active[0].status = 'par' as never; }],
    ['a status counter', battle => { battle.sides[1].active[0].statusState = { ...battle.sides[1].active[0].statusState, time: 3, startTime: 3 }; }],
    ['a volatile', battle => { battle.sides[0].active[0].volatiles['leechseed'] = { id: 'leechseed' } as never; }],
    ['a boost', battle => { battle.sides[1].active[0].boosts.atk = 2; }],
    ['the item', battle => { battle.sides[0].active[0].item = 'leftovers' as never; }],
    ['the ability', battle => { battle.sides[0].active[0].ability = 'levitate' as never; }],
    ['the weather', battle => { battle.field.weather = 'raindance' as never; battle.field.weatherState = { id: 'raindance', duration: 5 } as never; }],
    ['a body\'s fainted flag', battle => { battle.sides[1].active[0].fainted = true; }],
  ];
  test.each(moved)('%s moves the facts', (_name, change) => {
    const a = board();
    const b = board();
    expect(boardFacts(a)).toBe(boardFacts(b));
    change(b);
    expect(boardFacts(b)).not.toBe(boardFacts(a));
  });

  test('the field\'s duration moves the facts', () => {
    const a = board();
    const b = board();
    for (const battle of [a, b]) battle.field.weatherState = { id: 'raindance', duration: 5 } as never;
    expect(boardFacts(a)).toBe(boardFacts(b));
    (b.field.weatherState as { duration: number }).duration = 3;
    expect(boardFacts(b)).not.toBe(boardFacts(a));
  });

  test('the bookkeeping flags of a turn drop out after turn 1 and stay a fact on turn 1 (the simulator skips their reset there)', () => {
    const a = turnOf(rules, 'tackle', 'singles', '1,2,3,4');
    const b = turnOf(rules, 'tackle', 'singles', '1,2,3,4');
    expect(a.turn).toBeGreaterThan(1);
    b.sides[0].active[0].statsRaisedThisTurn = true;
    b.sides[0].active[0].moveThisTurn = 'tackle';
    b.lastSuccessfulMoveThisTurn = 'tackle';
    expect(boardFacts(b)).toBe(boardFacts(a));
    const first = board();
    const second = board();
    expect(first.turn).toBe(1);
    second.sides[0].active[0].statsRaisedThisTurn = true;
    expect(boardFacts(second)).not.toBe(boardFacts(first));
  });

  test('the facts leave the battle standing', () => {
    const battle = turnOf(rules, 'tackle', 'singles', '1,2,3,4');
    const before = JSON.stringify(State.serializeBattle(battle));
    boardFacts(battle);
    expect(JSON.stringify(State.serializeBattle(battle))).toBe(before);
  });
});

/**
 * Round 89 (A6-2): a finished battle has no later turn, so nothing reads what it holds beyond the winner. A game that ends in the middle of a
 * turn leaves the rest of the turn's actions in the queue (their nominal targets differ between draws), and the battle's last move is the
 * move of whichever action ran last; the prover returns at `battle.ended` before it reads either (`prove`).
 */
describe.each([RULES[8], CHAMPIONS])('a finished battle, $name', rules => {
  const finished = (winner: 'p1' | 'p2'): Battle => {
    const board = battleOf(rules.singles, [mon(rules, { species: 'Pikachu', moves: winner === 'p1' ? ['quickattack'] : ['tackle'] })], [mon(rules, { species: 'Pikachu', moves: winner === 'p1' ? ['tackle'] : ['quickattack'] })]);
    board.sides[winner === 'p1' ? 1 : 0].active[0].hp = 1;
    playClicks(board, { p1: 'move 1', p2: 'move 1' });
    return board;
  };

  test('the winner is a fact, the rest of the turn is not', () => {
    const a = finished('p1');
    const b = finished('p1');
    expect(a.ended && b.ended).toBe(true);
    // the queue holds the actions the game did not reach: a draw with other nominal targets leaves other leftovers
    expect(a.queue.list.length, 'the finished turn left its queue').toBeGreaterThan(0);
    b.queue.clear();
    b.lastMove = null;
    expect(boardFacts(b)).toBe(boardFacts(a));
    expect(boardFacts(finished('p2'))).not.toBe(boardFacts(a));
  });
});

/**
 * The source scan. A dropped key is safe only when no handler reads what a turn wrote in a later turn. The simulator ends every turn
 * with the resets (`Battle.endTurn`: `lastSuccessfulMoveThisTurn`, `moveThisTurn`, `statsRaisedThisTurn`, `statsLoweredThisTurn`), and
 * every read pinned here sits in a handler that runs while the turn runs: Burning Jealousy and Alluring Voice (stages raised this
 * turn), Lash Out (lowered this turn), Fusion Flare and Fusion Bolt (the move before this one), the Gen 1 and Gen 2 "already moved"
 * test in the move runner. `lastMoveTargetLoc` is the one key with a read in a later turn (Instruct, a locked or charging body):
 * those moves take a chosen target, so the facts keep the aim for them (rows above). A new reader in an updated simulator fails the
 * pin below and has to be classified here before the facts may drop its key.
 */
describe('the simulator reads a dropped key only where the facts keep it (source scan)', () => {
  const require = createRequire(import.meta.url);
  const roots = ['@pkmn/sim', '@pkmn/mods'].map(name => {
    const entry = require.resolve(name).split('\\').join('/');
    const root = entry.slice(0, entry.indexOf(`/${name}/`) + name.length + 2);
    return { name, root: name === '@pkmn/sim' ? `${root}build/cjs/` : `${root}build/` };
  });
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? files(`${dir}/${item.name}`) : item.name.endsWith('.js') ? [`${dir}/${item.name}`] : []);
  const sources = roots.flatMap(({ name, root }) => files(root.replace(/\/$/, '')).map(path => ({ file: `${name}:${path.slice(root.length)}`, lines: readFileSync(path, 'utf8').split('\n') })));

  /** The lines that read the key: a mention that is no comment and no plain assignment of the key. */
  function readsOf(key: string): string[] {
    const mention = new RegExp(`\\b${key}\\b`);
    const assign = new RegExp(`\\.${key}\\s*=[^=]`);
    return sources.flatMap(({ file, lines }) => lines.map(line => line.trim()).filter(line =>
      mention.test(line) && !/^(\/\/|\/\*|\*)/.test(line) && !assign.test(line) && !new RegExp(`^${key}\\s*[:,]`).test(line)).map(line => `${file}: ${line}`));
  }

  const PINNED: Record<string, string[]> = {
    statsRaisedThisTurn: ['@pkmn/sim:data/moves.js: if (target?.statsRaisedThisTurn) {', '@pkmn/sim:data/moves.js: if (target?.statsRaisedThisTurn) {'],
    statsLoweredThisTurn: ['@pkmn/sim:data/moves.js: if (source.statsLoweredThisTurn) {'],
    moveThisTurn: [
      '@pkmn/sim:data/mods/gen1/scripts.js: if (pokemon.moveThisTurn || !this.battle.runEvent(\'BeforeMove\', pokemon, target, move)) {',
      '@pkmn/sim:data/mods/gen2/scripts.js: if (pokemon.moveThisTurn) {',
      '@pkmn/sim:data/mods/gen2/scripts.js: this.battle.debug(`${pokemon.fullname} INCONSISTENT STATE, ALREADY MOVED: ${pokemon.moveThisTurn}`);',
      '@pkmn/sim:sim/battle-actions.js: this.battle.debug(`${pokemon.id} INCONSISTENT STATE, ALREADY MOVED: ${pokemon.moveThisTurn}`);',
      '@pkmn/mods:gen1stadium/index.js: if (pokemon.moveThisTurn || !this.battle.runEvent("BeforeMove", pokemon, target, move)) {',
      '@pkmn/mods:gen1stadium/index.js: this.battle.debug(`${pokemon.fullname} move interrupted; movedThisTurn: ${pokemon.moveThisTurn}`);',
    ],
    lastSuccessfulMoveThisTurn: [
      '@pkmn/sim:data/moves.js: if (this.lastSuccessfulMoveThisTurn === \'fusionflare\') {',
      '@pkmn/sim:data/moves.js: if (this.lastSuccessfulMoveThisTurn === \'fusionbolt\') {',
    ],
    [AIM_KEY]: [
      '@pkmn/sim:data/conditions.js: let moveTargetLoc = attacker.lastMoveTargetLoc;',
      '@pkmn/sim:data/moves.js: targetLoc: target.lastMoveTargetLoc,',
      '@pkmn/sim:sim/side.js: let lockedMoveTargetLoc = pokemon.lastMoveTargetLoc || 0;',
    ],
  };

  test('the facts drop exactly the keys this scan pins', () => {
    expect([...BOOKKEEPING_KEYS, AIM_KEY].sort()).toEqual(Object.keys(PINNED).filter(key => key !== 'lastSuccessfulMoveThisTurn').sort());
    expect([...BOOKKEEPING_FIELDS]).toEqual(['lastSuccessfulMoveThisTurn']);
  });

  test.each(Object.keys(PINNED))('%s: every read is a pinned one', key => {
    expect(readsOf(key).sort()).toEqual([...PINNED[key]].sort());
  });

  test.each(['statsRaisedThisTurn', 'statsLoweredThisTurn', 'moveThisTurn', 'lastSuccessfulMoveThisTurn'])('%s: the simulator resets it at the end of the turn', key => {
    const battle = sources.find(source => source.file === '@pkmn/sim:sim/battle.js')!;
    const text = battle.lines.join('\n');
    const endTurn = text.slice(text.indexOf('    endTurn() {'));
    const reset = new RegExp(`\\.${key} = (false|''|null);`);
    expect(reset.test(endTurn.slice(0, endTurn.indexOf('\n    }\n') + 1)), `${key} reset in Battle.endTurn`).toBe(true);
  });

  test('the roll fields are the round 88 list plus the hit data of A5f-1', () => {
    expect([...ROLL_FIELDS].sort()).toEqual(['damage', 'damageValue', 'hp', 'hurtThisTurn', 'lastDamage', 'moveHitData', 'totalDamage']);
  });
});
