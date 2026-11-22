import { toId } from '../ids.ts';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { effectLands, mayRefuseHit, type EffectScene, type SceneBody, type SceneEffect } from '../sim-ask/effect-refusal.ts';
import { clientPokemon } from './client-facts.ts';
import { illusionPossible, partyMayHideIllusion, possibleAbilities } from './item-evidence.ts';
import { findPokemon, ruleOut, type InferrerState } from './inferrer-state.ts';
import { arg, fromEffect, hasKw, identOf, keyOf, type LogLine } from './log-line.ts';

/**
 * Round 89 (#110): a landed effect rules out the abilities that would have refused it. The log shows a flinch (`|cant|X|flinch`), a
 * stat drop (`|-unboost|`), a major status (`|-status|`), confusion, Taunt or any other volatile a move adds (`|-start|`) landing on an
 * opponent Pokémon: whatever ability of its species the simulator would have refused that effect with cannot be its ability. The
 * simulator answers (sim-ask/effect-refusal.ts: a twin battle plays the scene with each candidate ability), so no list of abilities or
 * handlers stands here; blocked-effects-sweep.spec.ts holds the verdicts to whole battles for every ability of every generation and mod.
 *
 * The effect's source comes from the log: the Intimidate-like ability line just before a drop, the move resolving now (a status move's
 * own effect, or a secondary of a damaging move: read from the Dex move's own data), or, for a flinch, a move that hit the body this turn.
 * A body's candidates are the abilities of its species less the rule-outs (`possibleAbilities`); each is asked for every source the line
 * could name and every ability the source's species could hold (a drop an ability line announced takes that ability, whatever copied it: Transform, Trace;
 * a Mold Breaker kin sets `ignoreAbility` on the twin's move event, and the
 * battle's own `suppressingAbility` then skips the breakable handlers), and counts as blocked only when it refuses in all of them while
 * the same scene with no ability lets the effect land (a scene the log contradicts proves nothing). The ally of the body is asked too in
 * doubles: Flower Veil, Sweet Veil and the other guards of the `onAlly` kind refuse for their ally.
 * Nothing is ruled out when the log names Neutralizing Gas, when an Illusion user may stand on the team (the party of the team preview, or a game with no
 * preview from Generation 5: a disguise names another species on the hit, `partyMayHideIllusion`), when the body is transformed,
 * in another forme than its team entry, has its ability suppressed or changed, or when the abilities that refuse the effect are the whole
 * set the species has left (a contradiction: a misread or a rule the simulator lacks, never a proof). `blockedContradictions()` counts the last.
 *
 * Round 89 (#150): the damage of a move's hit (`|-damage|` without `[from]` while a move resolves) is an effect of the same reader, with the
 * move as its source: the twin plays the hit (Aqua Step into Dracovish: Water Absorb absorbs it, Strong Jaw does not) and every candidate
 * that refuses it in every way the attacker's species could have used it is out. This replaces the hand-written Levitate rule. A move that
 * sets its own type (an `onModifyType` handler), a Z-move or a Max move, and a move used under Electrify or Ion Deluge are not asked
 * (`blockedSkips()` counts them): the log does not show their type. The twin stands under the weather, terrain and field conditions
 * of the log (Gravity), and the target keeps the item, the types and the volatile conditions (Ingrain, Smack Down) the client shows.
 * The one known hole: a hidden Iron Ball grounds a Levitate holder and the log shows nothing of it. Cost: a hit asks the simulator only about the candidates
 * that could refuse a hit (`mayRefuseHit`: a handler in a hit's steps, grounding, a field set on entry, a type change), one scene for a candidate that lets
 * the hit land, and the scenes of one body's hits share their answers (the partner stands for its species' sake only).
 */

interface Hit { attacker: string; move: string }

export interface BlockedWatch {
  /** The moves that hit each body since the turn began (a flinch comes of one of them). */
  hitBy: Map<string, Hit[]>;
  /** The ability an Intimidate-like line announced since the last action boundary. */
  announced: { ident: string; ability: string } | null;
  /** Bodies whose ability the log suppressed (`|-endability|`, Gastro Acid), until they leave the field. */
  suppressed: Set<string>;
  /** The weather standing (a Dex condition id, '' for none), read from the `|-weather|` lines: the client keeps display names. */
  weather: string;
  /** The terrain and the other field conditions standing (Gravity, Trick Room, ...), as Dex condition ids, read from the `|-fieldstart|` and `|-fieldend|` lines. */
  terrain: string;
  fields: Set<string>;
  /** A condition that changes the type of a move stood this turn (Electrify, Ion Deluge): the type of the move in the log is not the Dex move's. */
  typeShift: boolean;
}

/** Events where every legal ability of the body would have refused the effect (nothing is ruled out for them), counted over the process. */
let contradictionCount = 0;
export const blockedContradictions = (): number => contradictionCount;
/**
 * Landed effects the reader could not judge, counted over the process: a hit by a move whose type the log does not show, and any effect on a side whose
 * party may hold an Illusion user the log never showed (no team preview).
 */
let skipCount = 0;
export const blockedSkips = (): number => skipCount;

/** One way the line's effect may have reached its target. */
interface Cause { source: string; effect: SceneEffect; route: EffectScene['route']; move?: string; ability?: string }

const BOUNDARIES = new Set(['move', 'switch', 'drag', 'turn', 'upkeep', 'cant', 'faint', 'replace']);

function watchOf(state: InferrerState): BlockedWatch {
  return (state.blockedWatch ??= { hitBy: new Map(), announced: null, suppressed: new Set(), weather: '', terrain: '', fields: new Set(), typeShift: false });
}

const SHIFT_LINES = new Set(['-singleturn', '-fieldactivate', '-fieldstart', '-sidestart', '-start', '-activate']);
const stripKind = (name: string): string => name.replace(/^(move|ability|item): /, '');

/** Whether the Dex condition behind the name carries a `ModifyType` handler (Electrify, Ion Deluge): it changes the type of the moves used under it. */
function changesMoveType(dex: RulesDex, name: string): boolean {
  const condition = name ? dex.conditions.get(stripKind(name)) : null;
  return !!condition?.exists && Object.keys(condition).some(key => /^on\w*ModifyType/.test(key));
}

/** The field conditions standing: a terrain is one slot, every other condition a pseudo-weather of the simulator's field. */
function trackField(state: InferrerState, watch: BlockedWatch, line: LogLine) {
  const condition = dexOf(state).conditions.get(stripKind(arg(line, 1)));
  if (!condition.exists) return;
  const standing = line.cmd === '-fieldstart';
  if (condition.effectType === 'Terrain') watch.terrain = standing ? condition.id : '';
  else if (standing) watch.fields.add(condition.id);
  else watch.fields.delete(condition.id);
}

/** The line's bookkeeping: the abilities the log suppressed, the announced Intimidate-like ability, the weather. */
function trackAbilities(state: InferrerState, watch: BlockedWatch, line: LogLine) {
  if (line.cmd === '-weather') watch.weather = arg(line, 1) === 'none' ? '' : dexOf(state).conditions.get(arg(line, 1)).id;
  if (line.cmd === '-fieldstart' || line.cmd === '-fieldend') trackField(state, watch, line);
  if (SHIFT_LINES.has(line.cmd) && [arg(line, 1), arg(line, 2)].some(name => changesMoveType(dexOf(state), name))) watch.typeShift = true;
  if (line.cmd === 'turn') watch.typeShift = false;
  if (BOUNDARIES.has(line.cmd)) watch.announced = null;
  if (line.cmd === 'switch' || line.cmd === 'drag' || line.cmd === 'replace') watch.suppressed.delete(keyOf(arg(line, 1)));
  if (line.cmd === '-endability') watch.suppressed.add(keyOf(arg(line, 1)));
  if (line.cmd === '-ability' && line.raw.split('|')[4] === 'boost') watch.announced = { ident: arg(line, 1), ability: arg(line, 2) };
}

/** The line's bookkeeping: the hits of the turn (a damage line of the resolving move on another Pokémon), then the abilities. */
function track(state: InferrerState, watch: BlockedWatch, line: LogLine) {
  if (line.cmd === 'turn') watch.hitBy = new Map();
  trackAbilities(state, watch, line);
  const pending = state.pendingMove;
  if (line.cmd === '-damage' && !hasKw(line, 'from') && pending && keyOf(pending.attacker) !== keyOf(arg(line, 1))) {
    watch.hitBy.set(keyOf(arg(line, 1)), [...(watch.hitBy.get(keyOf(arg(line, 1))) ?? []), { attacker: pending.attacker, move: pending.moveName }]);
  }
}

/** The ways a move's own Dex data delivers the effect to a target: its primary fields, its secondaries. */
function routesOf(dex: RulesDex, moveName: string, effect: SceneEffect): { route: 'primary' | 'secondary'; move: string }[] {
  const move = dex.moves.get(moveName);
  if (!move.exists) return [];
  const carries = (data: { volatileStatus?: string; status?: string; boosts?: Record<string, number> } | undefined): boolean => {
    if (!data) return false;
    if (effect.kind === 'volatile') return toId(data.volatileStatus ?? '') === effect.id;
    if (effect.kind === 'status') return toId(data.status ?? '') === effect.id;
    return (data.boosts?.[effect.stat ?? ''] ?? 0) < 0;
  };
  const found: { route: 'primary' | 'secondary'; move: string }[] = [];
  if (carries(move) && move.target !== 'self') found.push({ route: 'primary', move: move.id });
  if ([move.secondary, ...(move.secondaries ?? [])].some(secondary => carries(secondary ?? undefined))) found.push({ route: 'secondary', move: move.id });
  return found;
}

/** The effect a line shows landing on its subject, null for a line that shows none this reader asks about. */
function effectOf(line: LogLine): SceneEffect | null {
  if (line.cmd === 'cant' && arg(line, 2) === 'flinch') return { kind: 'volatile', id: 'flinch' };
  if (line.cmd === '-unboost') return { kind: 'boost', id: 'drop', stat: arg(line, 2) };
  if (line.cmd === '-status') return { kind: 'status', id: toId(arg(line, 2)) };
  if (line.cmd === '-damage' && !hasKw(line, 'from')) return { kind: 'hit', id: 'hit' };
  if (line.cmd === '-start' && !hasKw(line, 'fatigue')) return { kind: 'volatile', id: toId(arg(line, 2).replace(/^(move|ability|item): /, '')) };
  return null;
}

/**
 * The cause of a hit: the move resolving now, when it deals damage and its type is the Dex move's. A move that sets its own type
 * (Weather Ball, Tera Blast, Judgment, Hidden Power and kin: an `onModifyType` handler), a Z-move or a Max move, and any move used
 * under a condition that changes the type of moves (Electrify, Ion Deluge) are not asked: the log does not show the type, so the
 * line proves nothing (counted by `blockedSkips()`).
 */
function hitCauseOf(state: InferrerState, watch: BlockedWatch, target: string, effect: SceneEffect): { target: string; causes: Cause[]; unsure?: boolean } | null {
  const pending = state.pendingMove;
  const move = pending ? dexOf(state).moves.get(pending.moveName) : null;
  if (!pending || !move?.exists || move.category === 'Status') return null;
  // A name whose id is another move's (the typed Hidden Powers of the older generations) is the typed alias of a move the twin cannot select by name.
  const open = watch.typeShift || !!move.isZ || !!move.isMax || toId(pending.moveName) !== move.id || Object.keys(move).some(key => /^on\w*ModifyType/.test(key));
  return { target, causes: open ? [] : [{ source: pending.attacker, effect, route: 'primary', move: move.id }], unsure: open };
}

/**
 * The causes of the effect a line shows, and the body that took it. A flinch comes of a move that hit the body this turn; a drop that
 * follows an Intimidate-like announcement comes of that ability; the rest come of the move resolving now, by the routes its Dex data has.
 */
function causesOf(state: InferrerState, watch: BlockedWatch, line: LogLine): { target: string; causes: Cause[]; unsure?: boolean } | null {
  const target = arg(line, 1);
  // A line the effect of a move names (`[from] move: Spore` on a status) is the move's own; an item's or an ability's is another source.
  const from = fromEffect(line);
  const effect = effectOf(line);
  if (!target || !effect || (hasKw(line, 'from') && from.type !== 'move')) return null;
  if (effect.kind === 'hit') return hitCauseOf(state, watch, target, effect);
  if (effect.id === 'flinch') {
    const hits = watch.hitBy.get(keyOf(target)) ?? [];
    return { target, causes: hits.map(hit => ({ source: hit.attacker, effect, route: 'secondary' as const, move: hit.move })) };
  }
  if (effect.kind === 'boost' && watch.announced) {
    return { target, causes: [{ source: watch.announced.ident, effect, route: 'ability', ability: watch.announced.ability }] };
  }
  const pending = state.pendingMove;
  if (!pending) return null;
  const routes = routesOf(dexOf(state), from.type === 'move' ? from.name : pending.moveName, effect);
  return { target, causes: routes.map(found => ({ source: pending.attacker, effect, ...found })) };
}

/** The abilities the source may hold: the one the client shows, else the ones its species can have; null when the source is unknown. */
function sourceAbilities(state: InferrerState, ident: string): string[] | null {
  const mon = clientPokemon(state, ident);
  if (mon?.volatiles.transform) return null;
  if (mon?.ability) return [dexOf(state).abilities.get(mon.ability).name];
  // The forme the client shows now (a Mega Evolution changes the abilities), else the one the switch line named.
  const species = mon?.speciesForme || state.identSpecies.get(ident);
  const entry = species ? dexOf(state).species.get(species) : null;
  if (!entry?.exists) return null;
  const names = [...new Set(Object.values(entry.abilities ?? {}) as string[])];
  return names.length ? names : [''];
}

type HitState = Pick<SceneBody, 'item' | 'types' | 'volatiles'>;

/** What stands in a scene: the species the client shows, the ability the scene names. */
interface Holder { ident: string; species: string; role: 'self' | 'partner' }

/**
 * What the log shows of the body a hit lands on, which the simulator's hit steps read: its item (Iron Ball grounds a Levitate holder), its
 * types now (Wonder Guard reads them after a Tera or a type change) and its volatile conditions (Ingrain and Smack Down ground it).
 */
function hitStateOf(state: InferrerState, ident: string): HitState {
  const dex = dexOf(state);
  const mon = clientPokemon(state, ident);
  if (!mon) return {};
  // The types now, read from the client's facts (its own `types` getter needs the species in its Generations, which hide the Past ones).
  const own: string[] = [...dex.species.get(mon.speciesForme).types];
  let types = own;
  if (mon.isTerastallized && mon.teraType && mon.teraType !== 'Stellar') types = [mon.teraType];
  else if (mon.volatiles.typechange?.apparentType) types = mon.volatiles.typechange.apparentType.split('/');
  if (mon.volatiles.roost && types.includes('Flying')) types = types.filter(type => type !== 'Flying').concat(types.length === 1 ? ['Normal'] : []);
  return {
    item: mon.item && dex.items.get(mon.item).exists ? dex.items.get(mon.item).name : undefined,
    types: types.join('/') === own.join('/') ? undefined : types,
    volatiles: Object.keys(mon.volatiles).filter(id => dex.conditions.get(id).exists).sort(),
  };
}

/**
 * Whether the ability refuses the effect for one cause: with every ability of the source it refuses it, and for one of them the scene with no ability lets the
 * effect land (a scene the log contradicts proves nothing). The abilities of the source are asked one at a time, the candidate first: the first that lets the
 * effect land with the candidate ends the question, and the scene with no ability is asked only for a candidate that refuses. A candidate that does not refuse
 * costs one scene of the simulator; the partner of a body with an open ability stands for its species' sake only (no ability, no move), so the scene names the
 * target's own species for it, which lets the scenes of one body's hits share their answers.
 */
function refusedFor(state: InferrerState, watch: BlockedWatch, holder: Holder, partner: Holder | null, ability: string, cause: Cause, effectTarget: Holder, hitState: HitState | undefined): boolean {
  const dex = dexOf(state);
  // An ability the log announced (Intimidate) is the source's own at that moment, whatever its species or a Transform or Trace gave it.
  const abilities = cause.route === 'ability' && cause.ability ? [dex.abilities.get(cause.ability).name] : sourceAbilities(state, cause.source);
  const species = clientPokemon(state, cause.source)?.speciesForme || state.identSpecies.get(cause.source);
  if (!abilities || !species) return false;
  const scene = (given: string, sourceAbility: string): EffectScene => ({
    target: { species: effectTarget.species, ability: holder.role === 'self' ? given : '', ...hitState },
    partner: partner ? { species: holder.role === 'self' ? effectTarget.species : partner.species, ability: holder.role === 'partner' ? given : '' } : undefined,
    source: { species, ability: sourceAbility }, effect: cause.effect, route: cause.route, move: cause.move, ability: cause.ability, weather: watch.weather,
    ...(hitState ? { terrain: watch.terrain, fields: [...watch.fields].sort() } : {}),
  });
  let consistent = false;
  for (const sourceAbility of abilities) {
    if (effectLands(dex, scene(ability, sourceAbility)) !== false) return false;
    if (effectLands(dex, scene('', sourceAbility)) === true) consistent = true;
  }
  return consistent;
}

/** Whether the ability would have refused the effect in every way the line could have come about, and the scene with none lets it land. */
function refuses(state: InferrerState, watch: BlockedWatch, holder: Holder, partner: Holder | null, ability: string, causes: Cause[], effectTarget: Holder, hitState: HitState | undefined): boolean {
  return causes.length > 0 && causes.every(cause => refusedFor(state, watch, holder, partner, ability, cause, effectTarget, hitState));
}

/** The body the log's ident stands for in the client and the team: its species now, and whether its ability may be the team entry's. */
function holderOf(state: InferrerState, watch: BlockedWatch, ident: string, role: Holder['role']): { holder: Holder; nickname: string } | null {
  const nickname = identOf(ident)?.name;
  const mon = clientPokemon(state, ident);
  const info = nickname ? findPokemon(state, nickname) : undefined;
  if (!nickname || !mon || !info || info.ability.value || mon.fainted) return null;
  // An ability the client knows and the team entry did not adopt is not the entry's own (a Skill Swap, a Worry Seed): no proof about the entry.
  if (mon.ability || mon.baseAbility || mon.volatiles.transform || mon.volatiles.gastroacid || watch.suppressed.has(keyOf(ident))) return null;
  if (toId(mon.speciesForme) !== toId(info.species)) return null;
  return { holder: { ident, species: mon.speciesForme, role }, nickname };
}

/** The ally of the body on the field, in doubles. */
function allyOf(state: InferrerState, ident: string): string | null {
  const mon = clientPokemon(state, ident);
  const ally = mon?.side.active.find(other => other && other !== mon && !other.fainted);
  // The ident the log writes for the position (the client's own ident is the one without the slot letter).
  return ally ? `${identOf(ident)?.side}${String.fromCharCode(97 + ally.slot)}: ${ally.name}` : null;
}

/**
 * Rules out, for one holder, every candidate ability the simulator refuses the effect with (never the last legal one). For a hit only the candidates
 * that could refuse a hit at all are asked (`mayRefuseHit`); a body none of whose candidates could costs the simulator nothing.
 */
function ruleOutRefusers(state: InferrerState, watch: BlockedWatch, effectTarget: Holder, found: { holder: Holder; nickname: string }, partner: Holder | null, causes: Cause[]) {
  const candidates = possibleAbilities(state, found.holder.ident);
  if (!candidates || candidates.size === 0) return;
  const dex = dexOf(state);
  const hit = causes.some(cause => cause.effect.kind === 'hit');
  const asked = [...candidates].filter(id => !hit || mayRefuseHit(dex, id));
  if (asked.length === 0) return;
  const hitState = hit ? hitStateOf(state, effectTarget.ident) : undefined;
  const refused = asked.filter(id => refuses(state, watch, found.holder, partner, dex.abilities.get(id).name, causes, effectTarget, hitState));
  if (refused.length === 0) return;
  if (refused.length >= candidates.size) {
    contradictionCount++;
    return;
  }
  for (const id of refused) ruleOut(state, found.nickname, 'abilities', id);
}

/** The body that took the effect and its ally on the field (doubles), each with the team entry it stands for when its ability is open. */
function situationOf(state: InferrerState, watch: BlockedWatch, target: string) {
  const own = holderOf(state, watch, target, 'self');
  const species = (ident: string) => clientPokemon(state, ident)?.speciesForme ?? '';
  const effectTarget: Holder = own?.holder ?? { ident: target, species: species(target), role: 'self' };
  const allyIdent = state.hitWalk?.battle.gameType !== 'singles' ? allyOf(state, target) : null;
  const ally = allyIdent ? holderOf(state, watch, allyIdent, 'partner') : null;
  const partner: Holder | null = allyIdent && species(allyIdent) ? { ident: allyIdent, species: species(allyIdent), role: 'partner' } : null;
  return { own, effectTarget, ally, partner };
}

/** Whether the game lets the reader judge at all: a client walk, no Neutralizing Gas on the field, Generation 3 or later, abilities tied to species. */
function readable(state: InferrerState): boolean {
  const walk = state.hitWalk;
  return !!walk && !walk.neutralized && dexOf(state).gen >= 3 && !state.freeAbilities;
}

/**
 * Called once per line, after the client read it (inferOpponentTeam's loop): a flinch, a drop, a status or a volatile that landed on an
 * opponent Pokémon rules out the abilities of that Pokémon, and of its ally on the field, that the simulator refuses it with.
 */
export function watchBlockedEffects(state: InferrerState, line: LogLine) {
  const watch = watchOf(state);
  track(state, watch, line);
  if (!readable(state)) return;
  const read = causesOf(state, watch, line);
  if (!read || identOf(read.target)?.side !== state.opponentSide) return;
  if (read.unsure || partyMayHideIllusion(state)) skipCount++;
  // A cause that is the body itself (Close Combat, a reflected Intimidate) proves nothing about a guard against others.
  if (read.causes.length === 0 || read.causes.some(cause => keyOf(cause.source) === keyOf(read.target)) || illusionPossible(state) || partyMayHideIllusion(state)) return;
  const { own, effectTarget, ally, partner } = situationOf(state, watch, read.target);
  if (!effectTarget.species) return;
  if (own) ruleOutRefusers(state, watch, effectTarget, own, partner, read.causes);
  if (ally && partner) ruleOutRefusers(state, watch, effectTarget, ally, partner, read.causes);
}
