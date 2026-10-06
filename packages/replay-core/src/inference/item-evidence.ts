import { Battle, Dex } from '@pkmn/sim';
import { findPokemon, ruleOut, type InferrerState } from './inferrer-state.ts';
import { toId } from '../ids.ts';

/**
 * Items the protocol rules out by a line it does NOT show (round 63, T80):
 * a Life Orb holder's damaging hit always shows its recoil, Leftovers and
 * Black Sludge always show their end-of-turn line below full HP, and a
 * Rocky Helmet always hurts a contact attacker. The item-evidence tests run
 * each fact through @pkmn/sim. Only holders whose item is still unknown are
 * judged, and any doubt drops the judgment: a faint, an item line around
 * the hit, Magic Room, Embargo, Heal Block, or an ability the species may
 * have that hides the line (Magic Guard, Klutz, Sheer Force on a move with
 * a secondary effect, Long Reach).
 */

/** One resolving move: the plain hits it landed, the item lines it showed, who fainted. */
interface ActionWatch {
  ident: string;
  attacker: string;
  move: string;
  hits: Set<string>;
  shown: Set<string>;
  fainted: Set<string>;
  doubt: boolean;
}

export interface ItemWatch {
  action: ActionWatch | null;
  /** The latest HP line of each opponent Pokémon, by side and nickname. */
  hp: Map<string, string>;
  /** The opponent Pokémon on each field position. */
  slots: Map<string, string>;
  /** Each Pokémon's held item as the log shows it ('' after it lost it), by side and nickname. */
  items: Map<string, string>;
  /** The HP of the opponent's actives when the turn's residual phase began. */
  residual: Map<string, string> | null;
  /** Pokémon that showed a residual item line since then. */
  residualShown: Set<string>;
  /**
   * Pokémon whose items the residual phase may have silenced: blocked when it
   * began or at any line of it (Heal Block ends inside the phase, after the
   * Leftovers turn; Magic Room the same).
   */
  residualSilenced: Set<string>;
  healBlocked: Set<string>;
  embargoed: Set<string>;
  magicRoom: boolean;
}

// Not |replace|: an Illusion breaks inside the hit, before the attacker's recoil.
const ACTION_BOUNDARIES = new Set(['', 'move', 'switch', 'drag', 'cant', 'turn', 'upkeep']);
const ITEM_LINES = new Set(['-item', '-enditem']);
const RESIDUAL_ITEMS = ['leftovers', 'blacksludge'];
const FROM_ITEM = /\[from\] item:\s*([^|\n[]+)/;

/** "p2a: Nick" → "p2: Nick": one Pokémon whatever slot it stands in. */
const keyOf = (ident: string) => ident.replace(/^(p[1-4])[a-d]?:\s*/, '$1: ').trim();
const ofIdent = (line: string) => line.match(/\[of\]\s*(p[1-4][a-d]?:\s*[^|]+)/)?.[1] ?? null;
const hpOf = (text: string | undefined) => (text ?? '').split(' ')[0];

function newWatch(): ItemWatch {
  return {
    action: null, hp: new Map(), slots: new Map(), items: new Map(), residual: null, residualShown: new Set(), residualSilenced: new Set(),
    healBlocked: new Set(), embargoed: new Set(), magicRoom: false,
  };
}

/** Abilities the Pokémon may have: the known one, else its species' minus the rule-outs; null when unknown. */
function possibleAbilities(state: InferrerState, ident: string): Set<string> | null {
  const key = keyOf(ident);
  const opponent = key.startsWith(state.opponentSide);
  const info = opponent ? findPokemon(state, key.slice(4)) : undefined;
  const known = info && (info.ability.source === 'revealed' || info.ability.source === 'manual') ? toId(info.ability.value) : '';
  if (known) return new Set([known]);
  const species = info?.species ?? state.identSpecies.get(ident);
  const entry = species ? Dex.forGen(state.gen).species.get(species) : null;
  if (!entry?.exists) return null;
  const ruled = info?.ruledOut?.abilities ?? [];
  return new Set(Object.values(entry.abilities ?? {}).map(name => toId(String(name))).filter(id => id && !ruled.includes(id)));
}

/**
 * Illusion shows another party member's name (round 63 review): any
 * absence line on the side could belong to the disguised Pokémon, so a
 * team that may hold an Illusion user is not judged. The abilities come
 * from the Dex of the replay's generation; a revealed ability decides.
 */
function illusionPossible(state: InferrerState): boolean {
  const dex = Dex.forGen(state.gen);
  return [...state.pokemonMap.values()].some(mon => {
    const known = mon.ability.source === 'revealed' || mon.ability.source === 'manual' ? toId(mon.ability.value) : '';
    if (known) return known === 'illusion';
    const entry = dex.species.get(mon.species.replace(/-\*$/, ''));
    return entry.exists && Object.values(entry.abilities ?? {}).some(name => toId(String(name)) === 'illusion');
  });
}

/** Rules an item out for an opponent Pokémon whose item the log has not shown and no swap replaced. */
function ruleOutUnknown(state: InferrerState, key: string, itemId: string) {
  if (!key.startsWith(state.opponentSide) || illusionPossible(state)) return;
  const nickname = key.slice(4);
  const pokemon = findPokemon(state, nickname);
  if (!pokemon || (pokemon.item.value && pokemon.item.value !== '(has item)')) return;
  if ([...state.swappedIdents.keys()].some(ident => keyOf(ident) === key)) return;
  ruleOut(state, nickname, 'items', itemId);
}

/** Whether a Life Orb on the attacker would have shown its recoil after this hit. */
function lifeOrbWouldShow(state: InferrerState, watch: ItemWatch, action: ActionWatch): boolean {
  const move = Dex.forGen(state.gen).moves.get(action.move);
  if (!move.exists || move.category === 'Status' || move.flags.futuremove) return false;
  const abilities = possibleAbilities(state, action.ident);
  if (!abilities || abilities.has('magicguard') || abilities.has('klutz')) return false;
  if (abilities.has('sheerforce') && move.secondaries) return false;
  return !watch.magicRoom && !watch.embargoed.has(action.attacker);
}

/**
 * Whether a move from an attacker holding `heldItem` ('' for none) makes
 * contact, read from the simulator: the item's own move change (Punching
 * Glove takes contact from a punch), then `Battle#checkMoveMakesContact`
 * (Protective Pads). Any doubt reads as no contact (round 64, T120).
 */
export function contactLands(gen: number, moveName: string, heldItem: string): boolean {
  const dex = Dex.forGen(gen);
  const holder = { hasItem: (item: string | string[]) => [item].flat().map(toId).includes(heldItem), addVolatile: () => false };
  try {
    const move = dex.getActiveMove(moveName);
    const item = dex.items.get(heldItem) as { onModifyMove?: (this: never, ...args: never[]) => void };
    item.onModifyMove?.call({} as never, move as never, holder as never, null as never);
    return Battle.prototype.checkMoveMakesContact.call({} as never, move, holder as never, holder as never);
  } catch {
    return false;
  }
}

/**
 * Whether a Rocky Helmet on the target would have hurt this attacker. From
 * the generation of Protective Pads on, only an attacker whose item the log
 * showed is judged (round 64, decision 19; the fit corpus of round 63
 * showed helmets that stayed silent against Kleavor and Zapdos-Galar and
 * spoke later), and the simulator says whether that item lets it make contact.
 */
function helmetWouldShow(state: InferrerState, watch: ItemWatch, action: ActionWatch): boolean {
  const dex = Dex.forGen(state.gen);
  const pads = dex.items.get('protectivepads');
  const padsExist = pads.exists && pads.gen <= state.gen;
  const held = watch.items.get(action.attacker);
  if (padsExist && held === undefined) return false;
  const move = dex.moves.get(action.move);
  if (!move.exists || move.category === 'Status' || !move.flags.contact) return false;
  if (padsExist && !contactLands(state.gen, move.name, held ?? '')) return false;
  const abilities = possibleAbilities(state, action.ident);
  return !!abilities && !abilities.has('magicguard') && !abilities.has('longreach') && !watch.magicRoom;
}

function judgeAction(state: InferrerState, watch: ItemWatch, action: ActionWatch) {
  if (action.doubt || action.fainted.has(action.attacker)) return;
  const hitOthers = [...action.hits].filter(key => key !== action.attacker);
  if (hitOthers.length === 0) return;
  if (action.attacker.startsWith(state.opponentSide)) {
    if (!action.shown.has(`${action.attacker}|lifeorb`) && lifeOrbWouldShow(state, watch, action)) {
      ruleOutUnknown(state, action.attacker, 'lifeorb');
    }
    return;
  }
  if (!helmetWouldShow(state, watch, action)) return;
  for (const holder of hitOthers) {
    // A holder that may have Klutz ignores its item (the sim's ignoringItem).
    const judged = holder.startsWith(state.opponentSide) && !action.fainted.has(holder) &&
      !action.shown.has(`${holder}|rockyhelmet`) && !watch.embargoed.has(holder) &&
      possibleAbilities(state, holder)?.has('klutz') === false;
    if (judged) ruleOutUnknown(state, holder, 'rockyhelmet');
  }
}

/**
 * At |upkeep|: an opponent active below full HP when the residual phase
 * began, and no residual item line. Not before gen 3: gen 2 logs show
 * Leftovers holders below full HP without the heal (fit corpus 684843
 * turn 34, 72 such turns over 30 gen 2 games).
 */
function judgeResidual(state: InferrerState, watch: ItemWatch) {
  if (state.gen < 3) return;
  for (const [key, hp] of watch.residual ?? []) {
    const [current, max] = hp.split('/').map(Number);
    if (!(current > 0 && current < max) || watch.residualShown.has(key) || watch.residualSilenced.has(key)) continue;
    const abilities = possibleAbilities(state, key);
    if (!abilities || abilities.has('klutz')) continue;
    for (const item of RESIDUAL_ITEMS) ruleOutUnknown(state, key, item);
  }
}

function closeAction(state: InferrerState, watch: ItemWatch) {
  const action = watch.action;
  watch.action = null;
  if (action) judgeAction(state, watch, action);
}

/** Everyone the residual phase may have silenced, from its opening state and each line of it. */
function noteSilenced(watch: ItemWatch) {
  if (!watch.residual) return;
  for (const key of watch.residual.keys()) {
    if (watch.healBlocked.has(key) || watch.embargoed.has(key) || watch.magicRoom) watch.residualSilenced.add(key);
  }
}

interface LineContext {
  state: InferrerState;
  watch: ItemWatch;
  parts: string[];
  line: string;
  key: string;
  opponent: boolean;
}

/** A Pokémon entered: the opponent's positions and HP. */
function onEntry({ watch, parts, key, opponent }: LineContext) {
  if (!opponent) return;
  watch.slots.set((parts[2] ?? '').slice(0, 3), key);
  watch.hp.set(key, hpOf(parts[4]));
}

/** An HP line. Full HP inside the residual phase (Grassy Terrain before the Leftovers turn) leaves nothing to heal. */
function onHp({ watch, parts, key, opponent }: LineContext) {
  if (!opponent) return;
  watch.hp.set(key, hpOf(parts[3]));
  const [current, max] = hpOf(parts[3]).split('/').map(Number);
  if (watch.residual?.has(key) && current >= max) watch.residualSilenced.add(key);
}

function onFaint({ watch, key }: LineContext) {
  for (const [slot, holder] of watch.slots) if (holder === key) watch.slots.delete(slot);
  watch.residual?.delete(key);
}

/** Heal Block and Embargo silence a holder's item line. */
function onCondition({ watch, parts, line, key }: LineContext) {
  const add = parts[1] === '-start';
  if (/Heal Block/.test(line)) watch.healBlocked[add ? 'add' : 'delete'](key);
  if (/Embargo/.test(line)) watch.embargoed[add ? 'add' : 'delete'](key);
}

/** Magic Room silences every item. */
function onField({ watch, parts, line }: LineContext) {
  if (/Magic Room/.test(line)) watch.magicRoom = parts[1] === '-fieldstart';
}

/**
 * The item a line shows: `-item` gives the subject its item, `-enditem`
 * leaves it with none, a `[from] item:` effect names the item of its
 * `[of]` Pokémon or else of the subject (Life Orb, Rocky Helmet), an
 * `-activate` of an item names the subject's.
 */
function noteHeldItem(watch: ItemWatch, { parts, line, key }: LineContext) {
  const of = ofIdent(line);
  const fromItem = line.match(FROM_ITEM)?.[1]?.trim();
  const activated = parts[1] === '-activate' ? line.match(/\|item: ([^|]+)/)?.[1]?.trim() : undefined;
  if (parts[1] === '-item') watch.items.set(key, toId(parts[3] ?? ''));
  else if (parts[1] === '-enditem') watch.items.set(key, '');
  else if (fromItem) watch.items.set(of ? keyOf(of) : key, toId(fromItem));
  else if (activated) watch.items.set(key, toId(activated));
}

const BOARD: Record<string, (context: LineContext) => void> = {
  switch: onEntry, drag: onEntry, replace: onEntry,
  '-damage': onHp, '-heal': onHp, '-sethp': onHp,
  faint: onFaint, '-start': onCondition, '-end': onCondition, '-fieldstart': onField, '-fieldend': onField,
};

/**
 * An item line inside the resolving move: what it shows, and whether it
 * casts doubt. The attacker's own item moved (Magician, an Eject Pack), or
 * another Pokémon's item acted on it without a move of its own (Red Card,
 * Pickpocket): the hit proves nothing about the attacker's item.
 */
function noteItemLine(action: ActionWatch, { parts, line, key }: LineContext) {
  const of = ofIdent(line);
  const fromItem = line.match(FROM_ITEM)?.[1]?.trim();
  if (fromItem) action.shown.add(`${of && toId(fromItem) === 'rockyhelmet' ? keyOf(of) : key}|${toId(fromItem)}`);
  const tag = parts[1];
  const itemLine = ITEM_LINES.has(tag) || (tag === '-activate' && /item:/.test(line));
  if (itemLine && (key === action.attacker || (of && keyOf(of) === action.attacker && !/\[from\] move:/.test(line)))) {
    action.doubt = true;
  }
}

/** What the resolving move shows: plain hits, item lines, faints, doubt. */
function trackAction(watch: ItemWatch, context: LineContext) {
  const action = watch.action;
  if (!action) return;
  const { parts, line, key } = context;
  if (parts[1] === '-damage' && !line.includes('[from]')) action.hits.add(key);
  if (parts[1] === 'faint' || (parts[1] === '-damage' && /\|0 fnt/.test(line))) action.fainted.add(key);
  noteItemLine(action, context);
}

/** The phases: a "|" line opens the residual window, |upkeep| judges it, a plain |move| opens an action. */
function notePhase(state: InferrerState, watch: ItemWatch, parts: string[], line: string) {
  if (line === '|') {
    watch.residual = new Map([...watch.slots.values()].map(key => [key, watch.hp.get(key) ?? '']));
    watch.residualShown.clear();
    watch.residualSilenced.clear();
  } else if (parts[1] === 'upkeep') {
    judgeResidual(state, watch);
    watch.residual = null;
  } else if (parts[1] === 'move' && parts[2] && !line.includes('[from]')) {
    watch.action = {
      ident: parts[2], attacker: keyOf(parts[2]), move: parts[3] ?? '',
      hits: new Set(), shown: new Set(), fainted: new Set(), doubt: false,
    };
  }
}

/**
 * The line handler: closes the resolving move at each action boundary and
 * judges it, opens the next plain move, and judges the residual phase at
 * |upkeep| against the HP its opening "|" line found.
 */
export function watchItemEvidence(state: InferrerState, line: string) {
  const watch = (state.itemWatch ??= newWatch());
  const parts = line.split('|');
  if (parts.length >= 2 && ACTION_BOUNDARIES.has(parts[1])) closeAction(state, watch);
  notePhase(state, watch, parts, line);
  const key = keyOf(parts[2] ?? '');
  const context: LineContext = { state, watch, parts, line, key, opponent: key.startsWith(state.opponentSide) };
  BOARD[parts[1] ?? '']?.(context);
  if (parts[2]) noteHeldItem(watch, context);
  noteSilenced(watch);
  trackAction(watch, context);
  const fromItem = line.match(FROM_ITEM)?.[1]?.trim();
  if (watch.residual && fromItem && RESIDUAL_ITEMS.includes(toId(fromItem))) watch.residualShown.add(key);
}
