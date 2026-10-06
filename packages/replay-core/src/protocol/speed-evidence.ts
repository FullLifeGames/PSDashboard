import { gens, type ClientIdent, type ParserState } from './parser-state.ts';
import type { SpeedOrderObservation } from '../types.ts';
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
const SWAP_MOVE = /\[from\] move: (?:Trick|Switcheroo)/;

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
 * a theft) is noted for its holder and its giver, because the solver reads
 * a race against the set's item unless the order names the Scarf held.
 */
export function noteActivation(state: ParserState, line: string): void {
  const parts = line.split('|');
  const ident = parts[2] ?? '';
  const effect = parts[3] ?? '';
  if (!ident) return;
  if (line.startsWith('|-activate|') && /^move: (?:After You|Quash)$/.test(effect)) state.reordered.add(ident);
  if (line.startsWith('|-activate|') && /^(?:item: Quick Claw|ability: Quick Draw)$/.test(effect)) state.quickActed.add(ident);
  if (line.startsWith('|-enditem|') && effect === 'Custap Berry') state.quickActed.add(ident);
  for (const [holder, held] of scarfChanges(state, line, ident, effect)) {
    const mon = state.battle.getPokemon(holder as ClientIdent);
    if (!mon) continue;
    const key = `${holder.slice(0, 2)}:${mon.speciesForme}`;
    state.scarfChanges.set(key, [...(state.scarfChanges.get(key) ?? []), { turn: state.speedTurn, held }]);
  }
}

/**
 * The holders whose Scarf this line moves (round 63): a removed Scarf
 * (Knock Off, a theft, the giver's side of a swap into nothing), an
 * arriving one with its giver (`[of]`, else the other party of the pending
 * Trick or Switcheroo), and a known Scarf swapped for another item. Frisk
 * only reveals.
 */
function scarfChanges(state: ParserState, line: string, ident: string, item: string): [string, boolean][] {
  if (line.startsWith('|-enditem|')) return item === 'Choice Scarf' ? [[ident, false]] : [];
  if (!line.startsWith('|-item|') || !line.includes('[from]') || line.includes('ability: Frisk')) return [];
  if (item !== 'Choice Scarf') {
    return state.battle.getPokemon(ident as ClientIdent)?.item === 'choicescarf' ? [[ident, false]] : [];
  }
  const giver = line.match(/\[of\] (p[12][a-d]?: [^|]+)/)?.[1] ?? swapPartner(state, line, ident);
  return giver ? [[ident, true], [giver, false]] : [[ident, true]];
}

/** The other party of the pending Trick or Switcheroo. */
function swapPartner(state: ParserState, line: string, ident: string): string | undefined {
  const move = state.lastMove;
  if (!move || !SWAP_MOVE.test(line)) return undefined;
  if (move.attacker === ident) return move.target;
  return move.target === ident ? move.attacker : undefined;
}

/**
 * The races of a mon whose Scarf came or went: dropped in the turn it
 * moved (which item ran that race is open), read with the Scarf the mon
 * held at every other race. Before its first change a mon held the
 * opposite of what that change gave it.
 */
export function settleScarfMovers(state: ParserState): void {
  if (state.scarfChanges.size === 0) return;
  const held = (side: string, species: string, turn: number): boolean | null | undefined => {
    const changes = state.scarfChanges.get(`${side}:${species}`);
    if (!changes) return undefined;
    if (changes.some(change => change.turn === turn)) return null;
    const before = changes.filter(change => change.turn < turn);
    return before.length > 0 ? before[before.length - 1].held : !changes[0].held;
  };
  const settled: SpeedOrderObservation[] = [];
  for (const order of state.speedOrders) {
    const first = held(order.firstSide, order.firstSpecies, order.turn);
    const second = held(order.secondSide, order.secondSpecies, order.turn);
    if (first === null || second === null) continue;
    settled.push({
      ...order,
      ...(first === undefined ? {} : { firstScarf: first }),
      ...(second === undefined ? {} : { secondScarf: second }),
    });
  }
  state.speedOrders = settled;
}

/** A slot's forme change inside a turn (round 64): the forme before, the forme after, and whether a Mega Evolution made it. */
interface FormeChange {
  side: 'p1' | 'p2';
  from: string;
  to: string;
  mega: boolean;
}

type Side = 'p1' | 'p2';

/**
 * A transformed slot (round 64): its own species and the Pokémon it copied.
 * `shared` marks a copy another active slot of its side runs as its own,
 * where the order cannot tell the two movers apart.
 */
interface Copy {
  side: Side;
  own: string;
  copied: { side: Side; species: string };
  shared: boolean;
}

/** What one turn of the protocol says about its movers' formes. */
interface TurnRead {
  changes: FormeChange[];
  copies: Copy[];
}

/** An active slot: the species it entered as, and the Pokémon it copied. */
interface Slot {
  species: string;
  copied?: { side: Side; species: string };
}

/** The protocol the parse has read: the snapshots keep each turn's lines, the last turn is still open. */
const readLines = (state: ParserState) => [...state.snapshots.flatMap(snapshot => snapshot.log), ...state.currentTurnLines];

const speciesOf = (details: string) => details.split(',')[0].trim();
const sideOf = (slot: string) => slot.slice(0, 2) as Side;

function copyOf(slots: Map<string, Slot>, slot: string, entry: Slot): Copy | null {
  if (!entry.copied) return null;
  const shared = [...slots].some(([other, held]) =>
    other !== slot && sideOf(other) === sideOf(slot) && !held.copied && held.species === entry.copied!.species);
  return { side: sideOf(slot), own: entry.species, copied: entry.copied, shared };
}

/** The copies standing at a turn's start. */
const standingCopies = (slots: Map<string, Slot>) =>
  [...slots].map(([slot, entry]) => copyOf(slots, slot, entry)).filter((copy): copy is Copy => copy !== null);

/** A forme change of the slot (`detailschange`, `-formechange`), from the forme it held. */
function changeForme(slots: Map<string, Slot>, turn: TurnRead, slot: string, details: string): void {
  const entry = slots.get(slot);
  const to = speciesOf(details);
  if (!entry || entry.copied || entry.species === to) return;
  turn.changes.push({ side: sideOf(slot), from: entry.species, to, mega: false });
  entry.species = to;
}

/** A `-transform`: the slot copies its target from here on. */
function transform(slots: Map<string, Slot>, turn: TurnRead, slot: string, target: string): void {
  const entry = slots.get(slot);
  const copied = slots.get(target.slice(0, 3));
  if (!entry || !copied) return;
  entry.copied = { side: sideOf(target), species: copied.copied?.species ?? copied.species };
  const copy = copyOf(slots, slot, entry);
  if (copy) turn.copies.push(copy);
}

/** One slot line's part in its turn: an entry or a faint resets the slot, a change or a transform records itself, `-mega` marks the change. */
function readSlotLine(slots: Map<string, Slot>, turn: TurnRead, tag: string, ident: string, details: string): void {
  const slot = ident.slice(0, 3);
  if (tag === 'switch' || tag === 'drag' || tag === 'replace') slots.set(slot, { species: speciesOf(details) });
  else if (tag === 'faint') slots.delete(slot);
  else if (tag === 'detailschange' || tag === '-formechange') changeForme(slots, turn, slot, details);
  else if (tag === '-transform') transform(slots, turn, slot, details);
  const evolved = tag === '-mega' ? turn.changes.findLast(change => change.side === sideOf(slot)) : undefined;
  if (evolved) evolved.mega = true;
}

/** Per turn, the forme changes and the transformed slots the protocol shows. */
function readTurns(lines: string[]): Map<number, TurnRead> {
  const slots = new Map<string, Slot>();
  let turn: TurnRead = { changes: [], copies: [] };
  const turns = new Map<number, TurnRead>([[0, turn]]);
  for (const line of lines) {
    const [, tag, ident = '', details = ''] = line.split('|');
    if (tag === 'turn') {
      turn = { changes: [], copies: standingCopies(slots) };
      turns.set(parseInt(ident, 10), turn);
    } else {
      readSlotLine(slots, turn, tag, ident, details);
    }
  }
  return turns;
}

/**
 * The forme whose Speed raced (round 64, T122). The simulator sorts a turn
 * on the Speeds its movers had at the start of the turn in Gen 6 and below;
 * Gen 7 re-sorts a Pokémon that mega evolves, and Gen 8 and later re-sort
 * after every action (@pkmn/sim battle.js runAction). A mover whose forme
 * changed earlier in the turn under a rule that kept its old Speed raced
 * as the old forme, when the two run on different base Speeds.
 */
function racedForme(state: ParserState, changes: FormeChange[], side: Side, species: string): string {
  if (state.genNum >= 8) return species;
  const change = changes.find(entry => entry.side === side && entry.to === species && !(state.genNum === 7 && entry.mega));
  if (!change) return species;
  const dex = gens.get(state.genNum).species;
  return dex.get(change.from)?.baseStats.spe === dex.get(species)?.baseStats.spe ? species : change.from;
}

/**
 * The mover that raced: a transformed mover by its own species with the
 * Pokémon it copied (the simulator's Transform copies the target's stats,
 * the item stays its own), else the forme that raced; null when a copy and
 * its side's own Pokémon of that species stand together.
 */
function racedMover(state: ParserState, turn: TurnRead, side: Side, species: string): { species: string; copied?: Copy['copied'] } | null {
  const copy = turn.copies.find(entry => entry.side === side && entry.copied.species === species);
  if (copy) return copy.shared ? null : { species: copy.own, copied: copy.copied };
  return { species: racedForme(state, turn.changes, side, species) };
}

/** Every order names the mover that raced: its forme, or what it copied (round 64). */
export function settleRacedFormes(state: ParserState): void {
  const turns = readTurns(readLines(state));
  state.speedOrders = state.speedOrders.flatMap(order => {
    const turn = turns.get(order.turn);
    if (!turn || (turn.changes.length === 0 && turn.copies.length === 0)) return [order];
    const first = racedMover(state, turn, order.firstSide, order.firstSpecies);
    const second = racedMover(state, turn, order.secondSide, order.secondSpecies);
    if (!first || !second) return [];
    return [{
      ...order, firstSpecies: first.species, secondSpecies: second.species,
      ...(first.copied ? { firstCopied: first.copied } : {}), ...(second.copied ? { secondCopied: second.copied } : {}),
    }];
  });
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
