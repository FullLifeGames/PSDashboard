import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { RESIDUAL_EVENTS } from '../src/dex-facts/state-readers';
import { Interner, residualKey } from '../src/score/memo-keys';
import { playResiduals, residualReader, resetResidualMemo, slotsOf } from '../src/score/residuals';
import { copyOf } from '../src/sim-ask/copy';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEPS_FULL } from './dice-fixtures';
import { SWEEP_CASES, sweepMoves } from './dice-sweep-support';
import { attackerOf, boardFor, defenderOf, twoValues, verdictOf, type Verdict } from './board-key-support';

/**
 * Round 89 (#149, step A8, the sweep of ruling 28): the state of every effect the Dex knows, in both orders against the play.
 * Every condition the simulator resolves (a volatile, a side, slot or field condition, a weather, a terrain, a status) is placed
 * where it acts, and so is the state of every ability and item. Each own field of the effect's state that holds a number, a
 * flag or a stat name is set to two values, and on the two boards the keys must differ wherever the play reads differently:
 *
 * - the hit of a move that costs its user HP, played without a memo, against the key of the hit memo;
 * - the end of the turn, played without a memo, against the key of the end-of-turn memo (and every event it fires is one the
 *   key reads: RESIDUAL_EVENTS).
 *
 * Doubles put the effect on the attacker's partner and the foe's partner too. The plain run plays the four rule sets that count
 * most; `DICE_SWEEPS=full` plays every rule set and every condition.
 */

await loadSimMods('gen9championscustomgame');

const CASES = SWEEPS_FULL ? SWEEP_CASES : SWEEP_CASES.filter(({ name }) => ['Gen 9 singles', 'Gen 9 doubles', 'Champions singles', 'Champions doubles'].includes(name));

/** The conditions the plain run always plays, whatever the sample: a Substitute, a pending Future Sight, toxic, Leech Seed, sleep, confusion. */
const ALWAYS = ['substitute', 'futuremove', 'tox', 'leechseed', 'slp', 'confusion'];

type Kind = 'volatile' | 'side' | 'slot' | 'field' | 'weather' | 'terrain' | 'status';
type Dex = Battle['dex'];

/** Which kind of effect each condition id is, by what the Dex's moves and conditions say (a move names the effect it puts on a body, a side, a slot or the field). */
function kindsOf(dex: Dex): Map<string, Kind> {
  const kinds = new Map<string, Kind>();
  for (const move of dex.moves.all()) {
    if (move.volatileStatus) kinds.set(move.volatileStatus, 'volatile');
    if (move.sideCondition) kinds.set(move.sideCondition, 'side');
    if (move.slotCondition) kinds.set(move.slotCondition, 'slot');
    if (move.pseudoWeather) kinds.set(move.pseudoWeather, 'field');
    if (move.weather) kinds.set(dex.toID(move.weather), 'weather');
    if (move.terrain) kinds.set(dex.toID(move.terrain), 'terrain');
  }
  for (const id of Object.keys(dex.data.Conditions)) if (dex.conditions.get(id).effectType === 'Status') kinds.set(id, 'status');
  return kinds;
}

type Holder = 'attacker' | 'defender' | 'partner' | 'foePartner';
const holderBody = (battle: Battle, holder: Holder): Pokemon | undefined => ({
  attacker: battle.sides[0].active[0], defender: battle.sides[1].active[0], partner: battle.sides[0].active[1], foePartner: battle.sides[1].active[1],
})[holder] ?? undefined;

/** Puts the effect on the board where it acts and returns its state, or null where the simulator refuses it. */
function place(battle: Battle, kind: Kind, id: string, holder: Holder): Record<string, unknown> | null {
  const body = holderBody(battle, holder);
  if (!body) return null;
  const source = attackerOf(battle);
  try {
    switch (kind) {
      case 'volatile': return body.addVolatile(id, defenderOf(battle)) ? (body.volatiles[id] as Record<string, unknown>) : null;
      case 'status': return body.setStatus(id, defenderOf(battle)) ? (body.statusState as unknown as Record<string, unknown>) : null;
      case 'side': return body.side.addSideCondition(id, source) ? (body.side.sideConditions[id] as Record<string, unknown>) : null;
      case 'slot': return body.side.addSlotCondition(body, id, source) ? (body.side.slotConditions[body.position][id] as Record<string, unknown>) : null;
      case 'field': return battle.field.addPseudoWeather(id, source) ? (battle.field.pseudoWeather[id] as Record<string, unknown>) : null;
      case 'weather': return battle.field.setWeather(id, source) ? (battle.field.weatherState as unknown as Record<string, unknown>) : null;
      case 'terrain': return battle.field.setTerrain(id, source) ? (battle.field.terrainState as unknown as Record<string, unknown>) : null;
    }
  } catch {
    return null;
  }
}

/** The fields of a state that hold a value with a known second value: the effect's own bookkeeping, not its references. */
const fieldsOf = (state: Record<string, unknown>): string[] => Object.keys(state).filter(name => !['id', 'name', 'target', 'effectOrder', 'source', 'sourceSlot', 'sourceEffect'].includes(name) && twoValues(state[name]) !== undefined);

/** The end of the turn of a board played without a memo, and the events it fired. */
function freshResiduals(battle: Battle, fired: Set<string>): string {
  resetResidualMemo();
  const copy = copyOf(battle);
  const target = copy as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const call of ['runEvent', 'singleEvent', 'priorityEvent', 'eachEvent', 'fieldEvent']) {
    const original = target[call];
    target[call] = function (this: unknown, ...args: unknown[]) { fired.add(String(args[0])); return original.apply(this, args); };
  }
  playResiduals(copy, slotsOf(copy));
  const reader = residualReader(battle);
  return JSON.stringify(slotsOf(battle).map(pokemon => (pokemon ? reader(pokemon) ?? null : null)));
}

function residualVerdict(first: Battle, second: Battle, fired: Set<string>): Verdict {
  const interner = new Interner();
  const keys = [first, second].map(battle => residualKey(battle, slotsOf(battle), interner));
  const reads = [first, second].map(battle => freshResiduals(battle, fired));
  if (reads[0] === reads[1]) return 'same';
  return keys[0] === keys[1] ? 'wrong' : 'split';
}

describe.each(CASES)('the effect states are keyed on $name', ({ rules, mode, name }) => {
  const moves = sweepMoves(rules, move => !!move.recoil || !!move.struggleRecoil, true).moves;
  const move = moves.find(entry => entry.category === 'Physical')?.id ?? moves[0]?.id ?? 'tackle';
  const dex = boardFor(rules, mode, move).dex;
  const kinds = kindsOf(dex);
  const holders: Holder[] = mode === 'doubles' ? ['attacker', 'defender', 'partner', 'foePartner'] : ['attacker', 'defender'];

  test('every condition of the Dex, placed on each holder, with each field of its state at two values', () => {
    const wrong: string[] = [];
    const counts = { rows: 0, hitSplit: 0, residualSplit: 0 };
    const fired = new Set<string>();
    const ids = [...kinds.keys()].filter(id => dex.conditions.get(id).exists).filter((id, index) => SWEEPS_FULL || index % 3 === 0 || ALWAYS.includes(id));
    for (const id of ids) {
      for (const holder of holders) {
        const probe = boardFor(rules, mode, move);
        const state = place(probe, kinds.get(id)!, id, holder);
        if (!state) continue;
        for (const field of fieldsOf(state)) {
          const pair = twoValues(state[field])!;
          const boards = [0, 1].map(index => {
            const battle = boardFor(rules, mode, move);
            const placed = place(battle, kinds.get(id)!, id, holder)!;
            placed[field] = pair[index];
            return battle;
          });
          counts.rows++;
          const hit = verdictOf(boards[0], boards[1], move);
          const residual = residualVerdict(boards[0], boards[1], fired);
          if (hit === 'split') counts.hitSplit++;
          if (residual === 'split') counts.residualSplit++;
          if (hit === 'wrong') wrong.push(`${name} hit: ${id} (${kinds.get(id)}) on ${holder}, field ${field}`);
          if (residual === 'wrong') wrong.push(`${name} end of turn: ${id} (${kinds.get(id)}) on ${holder}, field ${field}`);
        }
      }
    }
    expect(counts.rows).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
    // Teeth: a Substitute's HP moves the hit, a pending Future Sight's turn the end of the turn.
    if (rules.generation >= 4) expect(counts.hitSplit).toBeGreaterThan(0);
    expect([...fired].filter(event => !RESIDUAL_EVENTS.has(event)).sort().join(' ')).toBe('');
  });

  test('the state of every ability and item a body holds, at two values', () => {
    const wrong: string[] = [];
    let rows = 0;
    const abilities = rules.generation >= 3 ? dex.abilities.all().filter(ability => ability.exists && !ability.isNonstandard && ability.id !== 'noability').map(ability => ability.id) : [];
    const items = rules.generation >= 2 ? dex.items.all().filter(item => item.exists && !item.isNonstandard).map(item => item.id) : [];
    const fired = new Set<string>();
    for (const [kind, ids] of [['ability', abilities], ['item', items]] as const) {
      for (const id of ids.filter((_, index) => SWEEPS_FULL || index % 4 === 0)) {
        for (const holder of holders) {
          const probe = boardFor(rules, mode, move, { [holder]: { [kind]: id } });
          const state = holderBody(probe, holder)?.[kind === 'ability' ? 'abilityState' : 'itemState'] as unknown as Record<string, unknown> | undefined;
          if (!state) continue;
          for (const field of fieldsOf(state)) {
            const pair = twoValues(state[field])!;
            const boards = [0, 1].map(index => {
              const battle = boardFor(rules, mode, move, { [holder]: { [kind]: id } });
              (holderBody(battle, holder)![kind === 'ability' ? 'abilityState' : 'itemState'] as unknown as Record<string, unknown>)[field] = pair[index];
              return battle;
            });
            rows++;
            if (verdictOf(boards[0], boards[1], move) === 'wrong') wrong.push(`${name} hit: ${kind} ${id} on ${holder}, field ${field}`);
            if (residualVerdict(boards[0], boards[1], fired) === 'wrong') wrong.push(`${name} end of turn: ${kind} ${id} on ${holder}, field ${field}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    // A generation without abilities and items has no rows.
    if (rules.generation >= 3) expect(rows).toBeGreaterThan(0);
  });
});

