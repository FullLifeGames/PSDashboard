import { Dex } from '@pkmn/sim';

/** A line the slot's choice made: a move, a switch, or a `|cant|` that names a move. */
const isOwnAction = (line: string) => /^\|(move|switch)\|/.test(line) || (line.startsWith('|cant|') && !!line.split('|')[4]);

/**
 * An own `|-activate|` of an ability that makes its holder leave mid-turn: the
 * Dex gives it an Emergency Exit handler (Emergency Exit and Wimp Out).
 */
function abilityAskedToLeave(line: string): boolean {
  const [, tag, , effect] = line.split('|');
  if (tag !== '-activate' || !effect?.startsWith('ability: ')) return false;
  const ability = Dex.abilities.get(effect.slice('ability: '.length));
  return 'onEmergencyExit' in ability && typeof ability.onEmergencyExit === 'function';
}

/**
 * Whether the slot's switch at `index` answers a forced request instead of
 * being the side's choice (round 64, T121). Current logs write `[from]` for
 * a move's selfSwitch; older logs (gen 6 and 8, 2022) write a pivot's switch
 * without `[from]`, after the slot's own move (653785 t5: Tornadus's U-turn,
 * then Excadrill). A body that left before it acted, ejected by its item
 * (751407 t1: Deoxys's Eject Pack, then Dragonite), sent out by its ability
 * (round 67, T133: Emergency Exit, Wimp Out) or fainted (gens 1 to 4 replace
 * before upkeep), had its replacement asked for, so the simulator writes the
 * request break (`|`) between that last own line and the switch. A Pursuit
 * that pops the Air Balloon of a body on its way out writes the chosen switch
 * right after the item line (round 64 review).
 */
export function answersForcedRequest(events: string[], index: number, ident: string): boolean {
  if (events[index].includes('[from]')) return true;
  const own = [...events.keys()].filter(at => at < index && events[at].split('|')[2]?.startsWith(ident));
  if (own.some(at => isOwnAction(events[at]))) return true;
  const last = own[own.length - 1];
  if (last === undefined || !events.slice(last + 1, index).includes('|')) return false;
  return /^\|(-enditem|faint)\|/.test(events[last]) || abilityAskedToLeave(events[last]);
}
