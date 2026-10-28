import { describe, expect, test } from 'vitest';
import { resolveSideChoices } from '../src/branch/execute';
import { createBranchStateFromBattle } from '../src/branch/state';
import type { SimBattle } from '../src/branch/types';
import { FORMATS, moveCommand, setOf, sideId, startBattle } from './branch-rule-battles';

/**
 * Round 77, A-1: the picker offered a move at 0 PP, and Execute failed with "Toxic Spikes is disabled
 * for Conscripts (Toxapex) right now." The picker read only `moveSlots[i].disabled`; the simulator's
 * request (pokemon.js getMoves) also disables a move at 0 PP, and for the reasons the Dex gives its
 * moves, items and abilities. The picker now asks the request, so the two agree on every reason.
 *
 * Each row plays a real turn that puts the victim under one reason (Disable, Taunt, Encore, Torment,
 * Imprison, Heal Block, Gravity, Throat Chop, a Choice item, Assault Vest, a move that cannot repeat)
 * or empties a move's PP, then compares every move button with the request the simulator sends. The
 * rows run with the victim on either side, in singles and in doubles.
 */

interface Row {
  name: string;
  victim: { moves: string[]; item?: string };
  source: { moves: string[] };
  /** What the victim and the source click on turn 1 (move names). */
  turn1: { victim: string; source: string };
  /** The move ids the simulator disables at the second request. */
  disabled: string[];
  /** Runs after turn 1, before the second request is read (a state the sim reaches only by PP loss). */
  after?: (battle: SimBattle, victimSide: number) => void;
}

const ROWS: Row[] = [
  { name: 'Taunt', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Taunt', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Taunt' }, disabled: ['swordsdance', 'recover'] },
  { name: 'Disable', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Disable', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Disable' }, disabled: ['tackle'] },
  { name: 'Encore', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Encore', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Encore' }, disabled: ['swordsdance', 'recover', 'hypervoice'] },
  { name: 'Torment', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Torment', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Torment' }, disabled: ['tackle'] },
  { name: 'Imprison', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Imprison', 'Tackle', 'Recover', 'Splash'] },
    turn1: { victim: 'Swords Dance', source: 'Imprison' }, disabled: ['tackle', 'recover'] },
  { name: 'Heal Block', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Heal Block', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Heal Block' }, disabled: ['recover'] },
  { name: 'Gravity', victim: { moves: ['Tackle', 'Splash', 'Fly', 'Hyper Voice'] }, source: { moves: ['Gravity', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Gravity' }, disabled: ['splash', 'fly'] },
  { name: 'Throat Chop', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Throat Chop', 'Splash'] },
    turn1: { victim: 'Tackle', source: 'Throat Chop' }, disabled: ['hypervoice'] },
  { name: 'Choice Scarf', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'], item: 'Choice Scarf' }, source: { moves: ['Splash'] },
    turn1: { victim: 'Tackle', source: 'Splash' }, disabled: ['swordsdance', 'recover', 'hypervoice'] },
  { name: 'Assault Vest', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'], item: 'Assault Vest' }, source: { moves: ['Splash'] },
    turn1: { victim: 'Tackle', source: 'Splash' }, disabled: ['swordsdance', 'recover'] },
  { name: 'a move that cannot repeat', victim: { moves: ['Gigaton Hammer', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Splash'] },
    turn1: { victim: 'Gigaton Hammer', source: 'Splash' }, disabled: ['gigatonhammer'] },
  { name: 'a move at 0 PP (A-1)', victim: { moves: ['Tackle', 'Toxic Spikes', 'Recover', 'Hyper Voice'] }, source: { moves: ['Splash'] },
    turn1: { victim: 'Tackle', source: 'Splash' }, disabled: ['toxicspikes'],
    after: (battle, victimSide) => {
      battle.sides[victimSide].active[0].moveSlots[1].pp = 0;
      battle.makeRequest('move');
    } },
];

function build(row: Row, format: typeof FORMATS[number], victimSide: number): SimBattle {
  const victim = [setOf('Pikachu', row.victim.moves, { item: row.victim.item ?? '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 } }),
    ...(format.doubles ? [setOf('Eevee', ['Splash'])] : []), setOf('Meowth', ['Splash'])];
  const source = [setOf('Snorlax', row.source.moves),
    ...(format.doubles ? [setOf('Corviknight', ['Splash'])] : []), setOf('Gliscor', ['Splash'])];
  const battle = startBattle(format.id, victimSide === 0 ? victim : source, victimSide === 0 ? source : victim);
  expect(battle.choose(sideId(victimSide), moveCommand(battle, row.turn1.victim, format.doubles)), 'victim turn 1').toBe(true);
  expect(battle.choose(sideId(1 - victimSide), moveCommand(battle, row.turn1.source, format.doubles)), 'source turn 1').toBe(true);
  row.after?.(battle, victimSide);
  return battle;
}

type RequestMove = { id: string; disabled?: unknown };
const requestMoves = (battle: SimBattle, side: number): RequestMove[] =>
  (battle.sides[side].activeRequest as unknown as { active: { moves: RequestMove[] }[] }).active[0].moves;
/**
 * The moves the player cannot click: the request's flag, or the slot's own (a hidden disable such as Imprison's
 * stays out of a singles request, which hides what the player cannot know; the omniscient picker still shows it).
 */
const unavailable = (battle: SimBattle, side: number): Map<string, boolean> => {
  const slots = battle.sides[side].active[0].moveSlots;
  return new Map(requestMoves(battle, side).map(move => [move.id, !!move.disabled || !!slots.find(slot => slot.id === move.id)?.disabled]));
};
const pickerMoves = (battle: SimBattle, side: number) => {
  const state = createBranchStateFromBattle(battle, [], {});
  return (side === 0 ? state.p1MovesBySlot : state.p2MovesBySlot)[0];
};

describe('A-1 every move button agrees with the simulator request', () => {
  for (const format of FORMATS) {
    for (const victimSide of [0, 1]) {
      for (const row of ROWS) {
        test(`${format.name}, ${sideId(victimSide)}: ${row.name}`, () => {
          const battle = build(row, format, victimSide);
          const expected = unavailable(battle, victimSide);
          // The row is real: the simulator disables exactly the expected moves.
          expect([...expected].filter(([, disabled]) => disabled).map(([id]) => id).sort()).toEqual([...row.disabled].sort());
          // The picker shows the same flag on every button.
          const picker = pickerMoves(battle, victimSide);
          expect(picker.map(move => move.disabled)).toEqual([...expected.values()]);
          // And a disabled button never reaches Execute as a command the simulator would refuse.
          const disabledButton = picker.find(move => move.disabled)!;
          const resolved = resolveSideChoices(battle, sideId(victimSide), [{ kind: 'move', moveId: disabledButton.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: disabledButton.name }], [true]);
          expect(resolved.ok).toBe(false);
        });
      }
    }
  }

  for (const format of FORMATS) {
    test(`${format.name}: with every move at 0 PP the picker offers what the request offers`, () => {
      const row: Row = { name: 'all empty', victim: { moves: ['Tackle', 'Swords Dance', 'Recover', 'Hyper Voice'] }, source: { moves: ['Splash'] },
        turn1: { victim: 'Tackle', source: 'Splash' }, disabled: [],
        after: (battle) => {
          for (const slot of battle.sides[0].active[0].moveSlots) slot.pp = 0;
          battle.makeRequest('move');
        } };
      const battle = build(row, format, 0);
      expect(requestMoves(battle, 0).map(move => move.id)).toEqual(['struggle']);
      const enabled = pickerMoves(battle, 0).filter(move => !move.disabled);
      expect(enabled.map(move => move.name)).toEqual(['Struggle']);
      const resolved = resolveSideChoices(battle, 'p1', [{ kind: 'move', moveId: 'struggle', moveName: 'Struggle' }], [true, ...(format.doubles ? [false] : [])]);
      expect(resolved.ok).toBe(true);
    });
  }
});
