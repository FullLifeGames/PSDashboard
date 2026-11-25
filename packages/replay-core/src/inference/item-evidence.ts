import { dexOf, type RulesDex } from '../rules-dex.ts';
import { Protocol } from '@pkmn/protocol';
import { findPokemon, ruleOut, type InferrerState } from './inferrer-state.ts';
import { arg, fromEffect, hasKw, keyOf, ofIdent, type LogLine } from './log-line.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';
import { spendsAfterOwnMove, spentAfterOwnMove, type SelfItem } from './spent-items.ts';
import { contactLands, noteContactTell } from './contact-tell.ts';

// Design: EVALUATION.md "Rule-outs".

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
  hp: Map<string, string>;
  slots: Map<string, string>;
  /** Held item as the log shows it ('' after it lost it), by side and nickname. */
  items: Map<string, string>;
  residual: Map<string, string> | null;
  residualShown: Set<string>;
  /** Blocked when the residual phase began or at any line of it (Heal Block ends inside it, after Leftovers). */
  residualSilenced: Set<string>;
  healBlocked: Set<string>;
  embargoed: Set<string>;
  magicRoom: boolean;
}

// Not |replace|: an Illusion breaks inside the hit, before the attacker's recoil. "done" is the "|" line.
const ACTION_BOUNDARIES = new Set(['done', 'move', 'switch', 'drag', 'cant', 'turn', 'upkeep']);
const ITEM_LINES = new Set(['-item', '-enditem']);
const RESIDUAL_ITEMS = ['leftovers', 'blacksludge'];

const healthOf = (text: string | undefined) => Protocol.parseHealth((text ?? '') as Protocol.PokemonHPStatus);
function belowFull(text: string | undefined): boolean {
  const health = healthOf(text);
  return !!health && health.hp > 0 && health.hp < health.maxhp;
}
const fromItem = (line: LogLine) => (fromEffect(line).type === 'item' ? fromEffect(line).name : '');
function activatedItem(line: LogLine): string {
  if (line.cmd !== '-activate' && line.cmd !== '-block') return '';
  const effect = Protocol.parseEffect(arg(line, 2));
  return effect.type === 'item' ? effect.name : '';
}

function newWatch(): ItemWatch {
  return {
    action: null, hp: new Map(), slots: new Map(), items: new Map(), residual: null, residualShown: new Set(), residualSilenced: new Set(),
    healBlocked: new Set(), embargoed: new Set(), magicRoom: false,
  };
}

function provenAbility(info: RevealedPokemonInfo | undefined): string {
  return info && (info.ability.source === 'revealed' || info.ability.source === 'manual') ? toId(info.ability.value) : '';
}

/** The abilities the Pokémon may have (known one, else its species' minus rule-outs); null when unknown or free. */
export function possibleAbilities(state: InferrerState, ident: string): Set<string> | null {
  const key = keyOf(ident);
  const opponent = key.startsWith(state.opponentSide);
  const info = opponent ? findPokemon(state, key.slice(4)) : undefined;
  const known = provenAbility(info);
  if (known) return new Set([known]);
  if (state.freeAbilities) return null;
  const species = info?.species ?? state.identSpecies.get(ident);
  const entry = species ? dexOf(state).species.get(species) : null;
  if (!entry?.exists) return null;
  const ruled = info?.ruledOut?.abilities ?? [];
  return new Set(Object.values(entry.abilities ?? {}).map(name => toId(String(name))).filter(id => id && !ruled.includes(id)));
}

/** Illusion shows another member's name, so a team that may hold an Illusion user is not judged. */
export function illusionPossible(state: InferrerState): boolean {
  const dex = dexOf(state);
  return [...state.pokemonMap.values()].some(mon => {
    const known = provenAbility(mon);
    if (known) return known === 'illusion';
    if (state.freeAbilities) return true;
    const entry = dex.species.get(mon.species.replace(/-\*$/, ''));
    return entry.exists && Object.values(entry.abilities ?? {}).some(name => toId(String(name)) === 'illusion');
  });
}

const hiddenParty = new WeakMap<InferrerState, boolean>();

/** Without team preview a disguised Zoroark enters as another species and the hit names it; no verdict from Gen 5. */
export function partyMayHideIllusion(state: InferrerState): boolean {
  const known = hiddenParty.get(state);
  if (known !== undefined) return known;
  const illusion = dexOf(state).abilities.get('illusion');
  const hidden = illusion.exists && illusion.gen <= dexOf(state).gen && !state.lines.some(line => line.cmd === 'poke' && arg(line, 1) === state.opponentSide);
  hiddenParty.set(state, hidden);
  return hidden;
}
export function unknownItemHolder(state: InferrerState, key: string): RevealedPokemonInfo | undefined {
  if (!key.startsWith(state.opponentSide) || illusionPossible(state)) return undefined;
  const pokemon = findPokemon(state, key.slice(4));
  if (!pokemon || (pokemon.item.value && pokemon.item.value !== '(has item)')) return undefined;
  return [...state.swappedIdents.keys()].some(ident => keyOf(ident) === key) ? undefined : pokemon;
}

export function ruleOutUnknown(state: InferrerState, key: string, itemId: string) {
  if (unknownItemHolder(state, key)) ruleOut(state, key.slice(4), 'items', itemId);
}

// Gen 4 arms Life Orb in `onBasePower`, which fixed-damage and one-hit KO moves never run; from Gen 5
// `onAfterMoveSecondarySelf` decides, on stubs (Gens 5 and 6 skip one-hit KO moves). A failing handler proves nothing.
function lifeOrbRecoils(dex: RulesDex, move: ReturnType<RulesDex['moves']['get']>): boolean {
  const lifeOrb = dex.items.get('lifeorb') as SelfItem & { onBasePower?: unknown };
  if (lifeOrb.onBasePower) return !move.damage && !move.damageCallback && !move.ohko;
  let recoil = false;
  try {
    const context = { damage: () => { recoil = true; }, dex };
    lifeOrb.onAfterMoveSecondarySelf?.call(context as never, { baseMaxhp: 100, forceSwitchFlag: false } as never, {} as never, move as never);
  } catch {
    return false;
  }
  return recoil;
}

// The gates the simulator reads before a move's own item acts: Klutz, Magic Room, Embargo, and Sheer Force on a move
// with secondaries (`suppressingSecondaries`).
function ownItemActs(state: InferrerState, watch: ItemWatch, action: ActionWatch, move: ReturnType<RulesDex['moves']['get']>): boolean {
  const abilities = possibleAbilities(state, action.ident);
  if (!abilities || abilities.has('klutz') || (abilities.has('sheerforce') && move.secondaries)) return false;
  return !watch.magicRoom && !watch.embargoed.has(action.attacker);
}

function lifeOrbWouldShow(state: InferrerState, watch: ItemWatch, action: ActionWatch): boolean {
  const dex = dexOf(state);
  const move = dex.moves.get(action.move);
  if (!move.exists || move.category === 'Status' || move.flags.futuremove || !lifeOrbRecoils(dex, move)) return false;
  return possibleAbilities(state, action.ident)?.has('magicguard') === false && ownItemActs(state, watch, action, move);
}

// The simulator heals an eighth of the damage after the move (`onAfterMoveSecondarySelf`, Gens 3 to 9).
function shellBellWouldShow(state: InferrerState, watch: ItemWatch, action: ActionWatch): boolean {
  const dex = dexOf(state);
  const bell = dex.items.get('shellbell');
  const move = dex.moves.get(action.move);
  if (!bell.exists || bell.gen > state.gen || !move.exists || move.category === 'Status') return false;
  if (!belowFull(watch.hp.get(action.attacker))) return false;
  return ownItemActs(state, watch, action, move) && !watch.healBlocked.has(action.attacker);
}

// From the generation of Protective Pads on, only an attacker whose item the log showed is judged.
function helmetWouldShow(state: InferrerState, watch: ItemWatch, action: ActionWatch): boolean {
  const dex = dexOf(state);
  const pads = dex.items.get('protectivepads');
  const padsExist = pads.exists && pads.gen <= state.gen;
  const held = watch.items.get(action.attacker);
  if (padsExist && held === undefined) return false;
  const move = dex.moves.get(action.move);
  if (!move.exists || move.category === 'Status' || !move.flags.contact) return false;
  if (padsExist && !contactLands(dex, move.name, held ?? '')) return false;
  const abilities = possibleAbilities(state, action.ident);
  return !!abilities && !abilities.has('magicguard') && !abilities.has('longreach') && !watch.magicRoom;
}

function judgeSpentItems(state: InferrerState, watch: ItemWatch, action: ActionWatch) {
  const dex = dexOf(state);
  const move = dex.moves.get(action.move);
  if (!move.exists || move.category === 'Status' || move.flags.futuremove || !ownItemActs(state, watch, action, move)) return;
  for (const id of spentAfterOwnMove(dex)) {
    if (!action.shown.has(`${action.attacker}|${id}`) && spendsAfterOwnMove(dex, id, move.name)) ruleOutUnknown(state, action.attacker, id);
  }
}

const identOfKey = (state: InferrerState, key: string) => [...state.identSpecies.keys()].find(ident => keyOf(ident) === key) ?? key;

function judgeSilentHelmet(state: InferrerState, watch: ItemWatch, action: ActionWatch, hitOthers: string[]) {
  const abilities = possibleAbilities(state, action.ident);
  const info = unknownItemHolder(state, action.attacker);
  if (!info || !abilities || abilities.has('magicguard') || abilities.has('longreach') || watch.magicRoom) return;
  const silent = hitOthers.some(holder => watch.items.get(holder) === 'rockyhelmet' && !action.shown.has(`${holder}|rockyhelmet`) &&
    !action.fainted.has(holder) && !watch.embargoed.has(holder) && possibleAbilities(state, identOfKey(state, holder))?.has('klutz') === false);
  if (silent) noteContactTell(state, info, action.move);
}

function judgeAttacker(state: InferrerState, watch: ItemWatch, action: ActionWatch, hitOthers: string[]) {
  judgeSilentHelmet(state, watch, action, hitOthers);
  judgeSpentItems(state, watch, action);
  if (!action.shown.has(`${action.attacker}|lifeorb`) && lifeOrbWouldShow(state, watch, action)) {
    ruleOutUnknown(state, action.attacker, 'lifeorb');
  }
  if (!action.shown.has(`${action.attacker}|shellbell`) && shellBellWouldShow(state, watch, action)) {
    ruleOutUnknown(state, action.attacker, 'shellbell');
  }
}

function judgeAction(state: InferrerState, watch: ItemWatch, action: ActionWatch) {
  if (action.doubt || action.fainted.has(action.attacker)) return;
  const hitOthers = [...action.hits].filter(key => key !== action.attacker);
  if (hitOthers.length === 0) return;
  if (action.attacker.startsWith(state.opponentSide)) {
    judgeAttacker(state, watch, action, hitOthers);
    return;
  }
  if (!helmetWouldShow(state, watch, action)) return;
  for (const holder of hitOthers) {
    const judged = holder.startsWith(state.opponentSide) && !action.fainted.has(holder) &&
      !action.shown.has(`${holder}|rockyhelmet`) && !watch.embargoed.has(holder) &&
      possibleAbilities(state, holder)?.has('klutz') === false;
    if (judged) ruleOutUnknown(state, holder, 'rockyhelmet');
  }
}

// Not before Gen 3: Gen 2 logs show Leftovers holders below full HP without the heal.
function judgeResidual(state: InferrerState, watch: ItemWatch) {
  if (state.gen < 3) return;
  for (const [key, hp] of watch.residual ?? []) {
    if (!belowFull(hp) || watch.residualShown.has(key) || watch.residualSilenced.has(key)) continue;
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

function noteSilenced(watch: ItemWatch) {
  if (!watch.residual) return;
  for (const key of watch.residual.keys()) {
    if (watch.healBlocked.has(key) || watch.embargoed.has(key) || watch.magicRoom) watch.residualSilenced.add(key);
  }
}

interface LineContext {
  state: InferrerState;
  watch: ItemWatch;
  line: LogLine;
  key: string;
  opponent: boolean;
}

function onEntry({ watch, line, key, opponent }: LineContext) {
  if (!opponent) return;
  watch.slots.set(arg(line, 1).slice(0, 3), key);
  watch.hp.set(key, arg(line, 3));
}

// Full HP inside the residual phase (Grassy Terrain before the Leftovers turn) leaves nothing to heal.
function onHp({ watch, line, key, opponent }: LineContext) {
  if (!opponent) return;
  watch.hp.set(key, arg(line, 2));
  const health = healthOf(arg(line, 2));
  if (watch.residual?.has(key) && health && health.hp >= health.maxhp) watch.residualSilenced.add(key);
}

function onSwap({ watch, line, opponent }: LineContext) {
  if (!opponent) return;
  const from = arg(line, 1).slice(0, 3);
  const to = `${from.slice(0, 2)}${'abcd'[Number(arg(line, 2))] ?? ''}`;
  const moved = watch.slots.get(from);
  const other = watch.slots.get(to);
  if (!moved || to === from) return;
  watch.slots.set(to, moved);
  if (other) watch.slots.set(from, other);
  else watch.slots.delete(from);
}

function onFaint({ watch, key }: LineContext) {
  for (const [slot, holder] of watch.slots) if (holder === key) watch.slots.delete(slot);
  watch.residual?.delete(key);
}

function onCondition({ watch, line, key }: LineContext) {
  const add = line.cmd === '-start';
  const effect = Protocol.parseEffect(arg(line, 2)).name;
  if (effect === 'Heal Block') watch.healBlocked[add ? 'add' : 'delete'](key);
  if (effect === 'Embargo') watch.embargoed[add ? 'add' : 'delete'](key);
}

function onField({ watch, line }: LineContext) {
  if (Protocol.parseEffect(arg(line, 1)).name === 'Magic Room') watch.magicRoom = line.cmd === '-fieldstart';
}

// `-item` gives, `-enditem` takes; a `[from] item:` effect names the item of its `[of]` Pokémon, else of the subject.
function noteHeldItem(watch: ItemWatch, { line, key }: LineContext) {
  const of = ofIdent(line);
  const shown = fromItem(line);
  const activated = activatedItem(line);
  if (line.cmd === '-item') watch.items.set(key, toId(arg(line, 2)));
  else if (line.cmd === '-enditem') watch.items.set(key, '');
  else if (shown) watch.items.set(of ? keyOf(of) : key, toId(shown));
  else if (activated) watch.items.set(key, toId(activated));
}

const BOARD: Record<string, (context: LineContext) => void> = {
  switch: onEntry, drag: onEntry, replace: onEntry, swap: onSwap,
  '-damage': onHp, '-heal': onHp, '-sethp': onHp,
  faint: onFaint, '-start': onCondition, '-end': onCondition, '-fieldstart': onField, '-fieldend': onField,
};

// Doubt: the attacker's own item moved (Magician, Eject Pack), or another Pokémon's item acted on it without a move of
// its own (Red Card, Pickpocket); the hit then proves nothing about the attacker's item.
function noteItemLine(action: ActionWatch, { line, key }: LineContext) {
  const of = ofIdent(line);
  const shown = fromItem(line);
  if (shown) action.shown.add(`${of && toId(shown) === 'rockyhelmet' ? keyOf(of) : key}|${toId(shown)}`);
  const itemLine = ITEM_LINES.has(line.cmd) || !!activatedItem(line);
  if (itemLine && (key === action.attacker || (of && keyOf(of) === action.attacker && fromEffect(line).type !== 'move'))) {
    action.doubt = true;
  }
}

function trackAction(watch: ItemWatch, context: LineContext) {
  const action = watch.action;
  if (!action) return;
  const { line, key } = context;
  if (line.cmd === '-damage' && !hasKw(line, 'from')) action.hits.add(key);
  if (line.cmd === 'faint' || (line.cmd === '-damage' && healthOf(arg(line, 2))?.fainted)) action.fainted.add(key);
  noteItemLine(action, context);
}

function notePhase(state: InferrerState, watch: ItemWatch, line: LogLine) {
  if (line.cmd === 'done') {
    watch.residual = new Map([...watch.slots.values()].map(key => [key, watch.hp.get(key) ?? '']));
    watch.residualShown.clear();
    watch.residualSilenced.clear();
  } else if (line.cmd === 'upkeep') {
    judgeResidual(state, watch);
    watch.residual = null;
  } else if (line.cmd === 'move' && arg(line, 1) && !hasKw(line, 'from')) {
    watch.action = {
      ident: arg(line, 1), attacker: keyOf(arg(line, 1)), move: arg(line, 2),
      hits: new Set(), shown: new Set(), fainted: new Set(), doubt: false,
    };
  }
}

export function watchItemEvidence(state: InferrerState, line: LogLine) {
  const watch = (state.itemWatch ??= newWatch());
  if (ACTION_BOUNDARIES.has(line.cmd)) closeAction(state, watch);
  notePhase(state, watch, line);
  const key = keyOf(arg(line, 1));
  const context: LineContext = { state, watch, line, key, opponent: key.startsWith(state.opponentSide) };
  BOARD[line.cmd]?.(context);
  if (arg(line, 1)) noteHeldItem(watch, context);
  noteSilenced(watch);
  trackAction(watch, context);
  const shown = fromItem(line);
  if (watch.residual && shown && RESIDUAL_ITEMS.includes(toId(shown))) watch.residualShown.add(key);
}
