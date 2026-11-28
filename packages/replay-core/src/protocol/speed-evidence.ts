import type { Generation } from '@pkmn/data';
import { speedContaminatedAt, type ClientIdent, type ParserState, type PendingMove } from './parser-state.ts';
import { raceEffects } from './speed-effects.ts';
import type { SpeedOrderObservation } from '../types.ts';
import { toId } from '../ids.ts';


const NOT_A_RACE = /\[from\]\s?(?:ability: |move: )?(?:Dancer|Instruct|Magic Bounce|Magic Coat|Snatch)/;
const AT_THE_SWITCH = /\[from\]\s?Pursuit/;
const SWAP_MOVE = /\[from\] move: (?:Trick|Switcheroo)/;

const WEATHER_ABILITY: Record<string, RegExp> = {
  swiftswim: /^(?:Rain|Heavy Rain)$/,
  chlorophyll: /^(?:Sun|Harsh Sunshine)$/,
  sandrush: /^Sand$/,
  slushrush: /^(?:Hail|Snow)$/,
};

export function foreignAction(line: string): boolean {
  return NOT_A_RACE.test(line);
}

/** A Pursuit on a switching target fires at the switch: no first-place claim, but still the mover's action. */
export function switchTriggered(line: string): boolean {
  return AT_THE_SWITCH.test(line);
}

/** Marks order exceptions: After You and Quash (rearranged), Quick Claw and kin (early), a Scarf that comes or goes. */
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

// A removed Scarf (Knock Off, a theft), an arriving one with its giver (`[of]`, else the other party of a Trick),
// and a known Scarf swapped for another item; Frisk only reveals.
function scarfChanges(state: ParserState, line: string, ident: string, item: string): [string, boolean][] {
  if (line.startsWith('|-enditem|')) return item === 'Choice Scarf' ? [[ident, false]] : [];
  if (!line.startsWith('|-item|') || !line.includes('[from]') || line.includes('ability: Frisk')) return [];
  if (item !== 'Choice Scarf') {
    return state.battle.getPokemon(ident as ClientIdent)?.item === 'choicescarf' ? [[ident, false]] : [];
  }
  const giver = line.match(/\[of\] (p[12][a-d]?: [^|]+)/)?.[1] ?? swapPartner(state, line, ident);
  return giver ? [[ident, true], [giver, false]] : [[ident, true]];
}

function swapPartner(state: ParserState, line: string, ident: string): string | undefined {
  const move = state.lastMove;
  if (!move || !SWAP_MOVE.test(line)) return undefined;
  if (move.attacker === ident) return move.target;
  return move.target === ident ? move.attacker : undefined;
}

/** Races of a mon whose Scarf came or went drop in its move turn; before its first change it held the opposite. */
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

type Side = 'p1' | 'p2';

// `resorted` marks a change the simulator's megaEvo action makes, which Gen 7 re-sorts the turn on.
interface TurnMon {
  side: Side;
  formes: { at: number; species: string; resorted: boolean }[];
  acted?: number;
}

// `shared`: another active slot of its side runs the copy as its own, so the order cannot tell the two movers apart.
interface Copy {
  side: Side;
  own: string;
  copied: { side: Side; species: string };
  shared: boolean;
  mon: TurnMon;
}

interface TurnRead {
  mons: TurnMon[];
  copies: Copy[];
}

interface Slot {
  species: string;
  copied?: { side: Side; species: string };
  mon: TurnMon;
}

interface SlotLine {
  slots: Map<string, Slot>;
  turn: TurnRead;
  line: string;
  slot: string;
  details: string;
  at: number;
  data: Generation;
}

const readLines = (state: ParserState) => [...state.snapshots.flatMap(snapshot => snapshot.log), ...state.currentTurnLines];

const speciesOf = (details: string) => details.split(',')[0].trim();
const sideOf = (slot: string) => slot.slice(0, 2) as Side;

function copyOf(slots: Map<string, Slot>, slot: string, entry: Slot): Copy | null {
  if (!entry.copied) return null;
  const shared = [...slots].some(([other, held]) =>
    other !== slot && sideOf(other) === sideOf(slot) && !held.copied && held.species === entry.copied!.species);
  return { side: sideOf(slot), own: entry.species, copied: entry.copied, shared, mon: entry.mon };
}

function enter({ slots, turn, slot, details, at }: SlotLine): void {
  const species = speciesOf(details);
  const mon: TurnMon = { side: sideOf(slot), formes: [{ at, species, resorted: false }] };
  turn.mons.push(mon);
  slots.set(slot, { species, mon });
}

/** The forme `runMegaEvo` changes into (`canMegaEvo`: the Mega Stone's forme, no `isMega` needed; `canUltraBurst`). */
export function megaEvolution(data: Generation, species: string): boolean {
  const forme = data.species.get(species);
  if (!forme) return false;
  const stone = forme.requiredItem ? data.items.get(forme.requiredItem) : undefined;
  return !!forme.isMega || !!stone?.zMove || Object.values(stone?.megaStone ?? {}).includes(forme.name);
}

function changeForme({ slots, slot, details, at, data }: SlotLine): void {
  const entry = slots.get(slot);
  const to = speciesOf(details);
  if (!entry || entry.copied || entry.species === to) return;
  entry.mon.formes.push({ at, species: to, resorted: megaEvolution(data, to) });
  entry.species = to;
}

function transform({ slots, turn, slot, details }: SlotLine): void {
  const entry = slots.get(slot);
  const copied = slots.get(details.slice(0, 3));
  if (!entry || !copied) return;
  entry.copied = { side: sideOf(details), species: copied.copied?.species ?? copied.species };
  const copy = copyOf(slots, slot, entry);
  if (copy) turn.copies.push(copy);
}

function swap({ slots, slot, details }: SlotLine): void {
  const target = `${sideOf(slot)}${'abcd'[Number(details)] ?? ''}`;
  const moved = slots.get(slot);
  const other = slots.get(target);
  if (other) slots.set(slot, other);
  else slots.delete(slot);
  if (moved) slots.set(target, moved);
}

function move({ slots, line, slot, at }: SlotLine): void {
  const mon = slots.get(slot)?.mon;
  if (mon && mon.acted === undefined && !foreignAction(line)) mon.acted = at;
}

const SLOT_LINES: Record<string, (line: SlotLine) => void> = {
  switch: enter, drag: enter, replace: enter, faint: ({ slots, slot }) => slots.delete(slot), swap,
  detailschange: changeForme, '-formechange': changeForme, '-transform': transform, move,
};

function startTurn(slots: Map<string, Slot>, at: number): TurnRead {
  const turn: TurnRead = { mons: [], copies: [] };
  for (const entry of slots.values()) {
    entry.mon = { side: entry.mon.side, formes: [{ at, species: entry.species, resorted: false }] };
    turn.mons.push(entry.mon);
  }
  turn.copies = [...slots].map(([slot, entry]) => copyOf(slots, slot, entry)).filter((copy): copy is Copy => copy !== null);
  return turn;
}

function readTurns(lines: string[], data: Generation): Map<number, TurnRead> {
  const slots = new Map<string, Slot>();
  let turn: TurnRead = { mons: [], copies: [] };
  const turns = new Map<number, TurnRead>([[0, turn]]);
  lines.forEach((line, at) => {
    const [, tag, ident = '', details = ''] = line.split('|');
    if (tag === 'turn') {
      turn = startTurn(slots, at);
      turns.set(parseInt(ident, 10), turn);
    } else {
      SLOT_LINES[tag]?.({ slots, turn, line, slot: ident.slice(0, 3), details, at, data });
    }
  });
  return turns;
}

const recordOf = (turn: TurnRead, side: Side, species: string) =>
  turn.copies.find(copy => copy.side === side && copy.copied.species === species)?.mon ??
  turn.mons.find(mon => mon.side === side && mon.formes.some(forme => forme.species === species));

// Gen 6 and below sort a turn once, on the Speeds at its start; Gen 7 also re-sorts a Pokémon its megaEvo changed;
// Gen 8 and later re-sort the movers still waiting after every action (@pkmn/sim battle.js runAction).
function formeAtSort(state: ParserState, mon: TurnMon, firstActed: number | undefined): string | undefined {
  if (state.genNum >= 8) return firstActed === undefined ? undefined : mon.formes.filter(forme => forme.at < firstActed).at(-1)?.species;
  return mon.formes.filter((forme, index) => index === 0 || (state.genNum === 7 && forme.resorted)).at(-1)?.species;
}

// Transform copies the target's stats, the item stays its own; null when a copy and its side's own mon stand together.
function racedMover(
  state: ParserState, turn: TurnRead, side: Side, species: string, firstActed: number | undefined,
): { species: string; copied?: Copy['copied'] } | null {
  const copy = turn.copies.find(entry => entry.side === side && entry.copied.species === species);
  if (copy) return copy.shared ? null : { species: copy.own, copied: copy.copied };
  const mon = recordOf(turn, side, species);
  const raced = mon && formeAtSort(state, mon, firstActed);
  const dex = state.battle.gens.get(state.genNum).species;
  return { species: raced && dex.get(raced)?.baseStats.spe !== dex.get(species)?.baseStats.spe ? raced : species };
}

export function settleRacedFormes(state: ParserState): void {
  const turns = readTurns(readLines(state), state.battle.gens.get(state.genNum));
  state.speedOrders = state.speedOrders.flatMap(order => {
    const turn = turns.get(order.turn);
    if (!turn) return [order];
    const firstActed = recordOf(turn, order.firstSide, order.firstSpecies)?.acted;
    const first = racedMover(state, turn, order.firstSide, order.firstSpecies, firstActed);
    const second = racedMover(state, turn, order.secondSide, order.secondSpecies, firstActed);
    if (!first || !second) return [];
    if (first.species === order.firstSpecies && second.species === order.secondSpecies && !first.copied && !second.copied) return [order];
    return [{
      ...order, firstSpecies: first.species, secondSpecies: second.species,
      ...(first.copied ? { firstCopied: first.copied } : {}), ...(second.copied ? { secondCopied: second.copied } : {}),
    }];
  });
}

function mayHaveAbility(state: ParserState, ident: string, abilityId: string): boolean {
  const mon = state.battle.getPokemon(ident as ClientIdent);
  if (!mon) return false;
  if (mon.ability) return mon.ability === abilityId;
  const species = state.battle.gens.get(state.genNum).species.get(mon.speciesForme);
  return Object.values(species?.abilities ?? {}).some(name => toId(String(name)) === abilityId);
}

function atFullHp(state: ParserState, ident: string): boolean {
  const mon = state.battle.getPokemon(ident as ClientIdent);
  return !!mon && mon.hp === mon.maxhp;
}

// Prankster, Gale Wings, Triage and Grassy Glide give the move a bracket above Speed.
function conditionalPriority(state: ParserState, ident: string, moveId: string): boolean {
  const move = state.battle.gens.get(state.genNum).moves.get(moveId);
  if (!move) return false;
  if (move.category === 'Status' && mayHaveAbility(state, ident, 'prankster')) return true;
  if (move.type === 'Flying' && mayHaveAbility(state, ident, 'galewings') && (state.genNum < 7 || atFullHp(state, ident))) return true;
  if (move.flags.heal && mayHaveAbility(state, ident, 'triage')) return true;
  return moveId === 'grassyglide' && state.battle.field.terrain === 'Grassy';
}

// Weather and terrain speed abilities, and Unburden after a lost item, double the mover's Speed.
function fieldSpeed(state: ParserState, ident: string): boolean {
  const { weather, terrain } = state.battle.field;
  for (const [ability, pattern] of Object.entries(WEATHER_ABILITY)) {
    if (weather && pattern.test(weather) && mayHaveAbility(state, ident, ability)) return true;
  }
  if (terrain === 'Electric' && mayHaveAbility(state, ident, 'surgesurfer')) return true;
  const mon = state.battle.getPokemon(ident as ClientIdent);
  return !!mon && !mon.item && !!mon.lastItem && mayHaveAbility(state, ident, 'unburden');
}

export function firstMoverContaminated(state: ParserState, ident: string, moveId: string): boolean {
  return state.quickActed.has(ident) || conditionalPriority(state, ident, moveId) || fieldSpeed(state, ident);
}

/** Anything that makes the second mover act last regardless of Speed (`null` move: a knocked-out victim). */
export function secondMoverContaminated(state: ParserState, ident: string, moveId: string | null): boolean {
  if (mayHaveAbility(state, ident, 'stall')) return true;
  if (moveId !== null && mayHaveAbility(state, ident, 'myceliummight')) {
    return state.battle.gens.get(state.genNum).moves.get(moveId)?.category === 'Status';
  }
  return false;
}

// Earthquake and Explosion hit the partner too, so the target must stand on the other side.
function faintProvesOrder(state: ParserState, victim: string, lastMove: PendingMove): boolean {
  return victim === lastMove.target && victim !== lastMove.attacker &&
    victim.slice(0, 2) !== lastMove.attacker.slice(0, 2) &&
    lastMove.speedClean && !state.actedThisTurn.has(victim) && !state.reordered.has(victim) &&
    !speedContaminatedAt(state, victim, 'second') && !secondMoverContaminated(state, victim, null);
}

// A KO before the victim acted proves the attacker faster: a chosen switch would have resolved first and left a line.
export function recordFaintSpeedEvidence(state: ParserState, line: string) {
  const { lastMove, battle } = state;
  if (!(line.startsWith('|faint|') && lastMove)) return;
  const victim = line.split('|')[2] ?? '';
  if (!faintProvesOrder(state, victim, lastMove)) return;
  const victimMon = battle.getPokemon(victim as ClientIdent);
  if (!victimMon) return;
  const { effects: secondSpeed, lowered } = raceEffects(state, victimMon, lastMove.seen);
  if (lowered) return;
  const { effects: firstSpeed } = raceEffects(state, battle.getPokemon(lastMove.attacker as ClientIdent), lastMove.seen);
  state.speedOrders.push({
    firstSide: lastMove.attackerSide, firstSpecies: lastMove.attackerSpecies,
    secondSide: victim.startsWith('p1') ? 'p1' : 'p2',
    secondSpecies: victimMon.speciesForme,
    turn: state.speedTurn,
    knockOut: true,
    ...(firstSpeed ? { firstSpeed } : {}),
    ...(secondSpeed ? { secondSpeed } : {}),
  });
}
