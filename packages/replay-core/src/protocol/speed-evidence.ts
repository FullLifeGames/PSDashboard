import { gens, type ClientIdent, type ParserState } from './parser-state.ts';
import { toId } from '../ids.ts';

/**
 * Cleanliness of speed evidence: everything that explains a move order
 * without Speed (round 37). A |move| line another effect produced (Dancer,
 * Instruct, a bounced or snatched status move) is not the mover's own
 * action, a Pursuit on a switching target fires at the switch, and After
 * You or Quash rearrange a target's slot for the turn. Conditional
 * priority, quick items, weather and terrain abilities let a first mover
 * act early; Stall and Mycelium Might make a second mover act last.
 */

const NOT_A_RACE = /\[from\]\s?(?:ability: |move: )?(?:Dancer|Instruct|Magic Bounce|Magic Coat|Snatch)/;
const AT_THE_SWITCH = /\[from\]\s?Pursuit/;

const WEATHER_ABILITY: Record<string, RegExp> = {
  swiftswim: /^(?:Rain|Heavy Rain)$/,
  chlorophyll: /^(?:Sun|Harsh Sunshine)$/,
  sandrush: /^Sand$/,
  slushrush: /^(?:Hail|Snow)$/,
};

/** A move line that was not this mover's own place in the turn order. */
export function foreignAction(line: string): boolean {
  return NOT_A_RACE.test(line);
}

/**
 * A Pursuit on a switching target fires at the switch: no claim to have
 * moved first, but still the mover's action (a U-turn user that moved
 * before it did win the race).
 */
export function switchTriggered(line: string): boolean {
  return AT_THE_SWITCH.test(line);
}

/**
 * After You and Quash mark their target as rearranged for the turn; a
 * Quick Claw, Quick Draw, or Custap Berry activation marks the holder as
 * having acted early; a Choice Scarf that comes or goes (Knock Off, Trick,
 * a theft) marks the holder for the whole game, because the solver reads
 * every race against the set's item.
 */
export function noteActivation(state: ParserState, line: string): void {
  const parts = line.split('|');
  const ident = parts[2] ?? '';
  const effect = parts[3] ?? '';
  if (!ident) return;
  if (line.startsWith('|-activate|') && /^move: (?:After You|Quash)$/.test(effect)) state.reordered.add(ident);
  if (line.startsWith('|-activate|') && /^(?:item: Quick Claw|ability: Quick Draw)$/.test(effect)) state.quickActed.add(ident);
  if (line.startsWith('|-enditem|') && effect === 'Custap Berry') state.quickActed.add(ident);
  if (scarfChangesHands(state, line, ident, effect)) {
    const mon = state.battle.getPokemon(ident as ClientIdent);
    if (mon) state.scarfMoved.add(`${ident.slice(0, 2)}:${mon.speciesForme}`);
  }
}

/** A Choice Scarf removed, or one arriving by a move or a stealing ability (Frisk only reveals). */
function scarfChangesHands(state: ParserState, line: string, ident: string, item: string): boolean {
  if (line.startsWith('|-enditem|')) return item === 'Choice Scarf';
  if (!line.startsWith('|-item|') || !line.includes('[from]') || line.includes('ability: Frisk')) return false;
  const before = state.battle.getPokemon(ident as ClientIdent)?.item ?? '';
  return item === 'Choice Scarf' || before === 'choicescarf';
}

/** The orders a mon with a changing Scarf took part in are no evidence about the set's item. */
export function dropScarfMovers(state: ParserState): void {
  if (state.scarfMoved.size === 0) return;
  state.speedOrders = state.speedOrders.filter(order =>
    !state.scarfMoved.has(`${order.firstSide}:${order.firstSpecies}`) && !state.scarfMoved.has(`${order.secondSide}:${order.secondSpecies}`));
}

/**
 * The mon can have the ability: the client knows its ability (a revealed
 * one) and it is this one, or nothing is known and the species carries it
 * in a slot of the replay's generation. A revealed other ability relieves.
 */
function mayHaveAbility(state: ParserState, ident: string, abilityId: string): boolean {
  const mon = state.battle.getPokemon(ident as ClientIdent);
  if (!mon) return false;
  if (mon.ability) return mon.ability === abilityId;
  const species = gens.get(state.genNum).species.get(mon.speciesForme);
  return Object.values(species?.abilities ?? {}).some(name => toId(String(name)) === abilityId);
}

function atFullHp(state: ParserState, ident: string): boolean {
  const mon = state.battle.getPokemon(ident as ClientIdent);
  return !!mon && mon.hp === mon.maxhp;
}

/** Prankster, Gale Wings, Triage, and Grassy Glide give the move a bracket above Speed. */
function conditionalPriority(state: ParserState, ident: string, moveId: string): boolean {
  const move = gens.get(state.genNum).moves.get(moveId);
  if (!move) return false;
  if (move.category === 'Status' && mayHaveAbility(state, ident, 'prankster')) return true;
  if (move.type === 'Flying' && mayHaveAbility(state, ident, 'galewings') && (state.genNum < 7 || atFullHp(state, ident))) return true;
  if (move.flags.heal && mayHaveAbility(state, ident, 'triage')) return true;
  return moveId === 'grassyglide' && state.battle.field.terrain === 'Grassy';
}

/** Weather and terrain speed abilities, and Unburden after a lost item, double the mover's Speed. */
function fieldSpeed(state: ParserState, ident: string): boolean {
  const { weather, terrain } = state.battle.field;
  for (const [ability, pattern] of Object.entries(WEATHER_ABILITY)) {
    if (weather && pattern.test(weather) && mayHaveAbility(state, ident, ability)) return true;
  }
  if (terrain === 'Electric' && mayHaveAbility(state, ident, 'surgesurfer')) return true;
  const mon = state.battle.getPokemon(ident as ClientIdent);
  return !!mon && !mon.item && !!mon.lastItem && mayHaveAbility(state, ident, 'unburden');
}

/** Anything that lets the first mover act early without being faster. */
export function firstMoverContaminated(state: ParserState, ident: string, moveId: string): boolean {
  return state.quickActed.has(ident) || conditionalPriority(state, ident, moveId) || fieldSpeed(state, ident);
}

/** Anything that makes the second mover act last regardless of Speed (`null` move: a knocked-out victim). */
export function secondMoverContaminated(state: ParserState, ident: string, moveId: string | null): boolean {
  if (mayHaveAbility(state, ident, 'stall')) return true;
  if (moveId !== null && mayHaveAbility(state, ident, 'myceliummight')) {
    return gens.get(state.genNum).moves.get(moveId)?.category === 'Status';
  }
  return false;
}
