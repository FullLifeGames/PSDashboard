import { toId } from '../ids.ts';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { effectLands, mayRefuseHit, type EffectScene, type SceneBody, type SceneEffect } from '../sim-ask/effect-refusal.ts';
import { clientPokemon } from './client-facts.ts';
import { illusionPossible, partyMayHideIllusion, possibleAbilities } from './item-evidence.ts';
import { findPokemon, ruleOut, type InferrerState } from './inferrer-state.ts';
import { arg, fromEffect, hasKw, identOf, keyOf, type LogLine } from './log-line.ts';

/** A landed effect or hit rules out the abilities the simulator would have refused it with, asked on a twin battle; the design is in EVALUATION.md, "Rule-outs". */

interface Hit { attacker: string; move: string }

export interface BlockedWatch {
  /** The moves that hit each body since the turn began (a flinch comes of one of them). */
  hitBy: Map<string, Hit[]>;
  /** The ability an Intimidate-like line announced since the last action boundary. */
  announced: { ident: string; ability: string } | null;
  /** Bodies whose ability the log suppressed (`|-endability|`, Gastro Acid), until they leave the field. */
  suppressed: Set<string>;
  /** The weather standing (a Dex condition id, '' for none): the client keeps display names. */
  weather: string;
  /** The terrain and the other field conditions standing (Gravity, Trick Room, ...), as Dex condition ids. */
  terrain: string;
  fields: Set<string>;
  /** A condition that changes the type of a move stood this turn (Electrify, Ion Deluge): the type of the move in the log is not the Dex move's. */
  typeShift: boolean;
}

/** Events where every legal ability of the body would have refused the effect (nothing is ruled out), counted over the process. */
let contradictionCount = 0;
export const blockedContradictions = (): number => contradictionCount;
/** Landed effects the reader could not judge (a hit by a move whose type the log does not show, an effect on a side whose party may hold an unseen Illusion user), counted over the process. */
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

function trackField(state: InferrerState, watch: BlockedWatch, line: LogLine) {
  const condition = dexOf(state).conditions.get(stripKind(arg(line, 1)));
  if (!condition.exists) return;
  const standing = line.cmd === '-fieldstart';
  if (condition.effectType === 'Terrain') watch.terrain = standing ? condition.id : '';
  else if (standing) watch.fields.add(condition.id);
  else watch.fields.delete(condition.id);
}

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

function track(state: InferrerState, watch: BlockedWatch, line: LogLine) {
  if (line.cmd === 'turn') watch.hitBy = new Map();
  trackAbilities(state, watch, line);
  const pending = state.pendingMove;
  if (line.cmd === '-damage' && !hasKw(line, 'from') && pending && keyOf(pending.attacker) !== keyOf(arg(line, 1))) {
    watch.hitBy.set(keyOf(arg(line, 1)), [...(watch.hitBy.get(keyOf(arg(line, 1))) ?? []), { attacker: pending.attacker, move: pending.moveName }]);
  }
}

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

function effectOf(line: LogLine): SceneEffect | null {
  if (line.cmd === 'cant' && arg(line, 2) === 'flinch') return { kind: 'volatile', id: 'flinch' };
  if (line.cmd === '-unboost') return { kind: 'boost', id: 'drop', stat: arg(line, 2) };
  if (line.cmd === '-status') return { kind: 'status', id: toId(arg(line, 2)) };
  if (line.cmd === '-damage' && !hasKw(line, 'from')) return { kind: 'hit', id: 'hit' };
  if (line.cmd === '-start' && !hasKw(line, 'fatigue')) return { kind: 'volatile', id: toId(arg(line, 2).replace(/^(move|ability|item): /, '')) };
  return null;
}

/** The cause of a hit: the move resolving now, when it deals damage and its type is the Dex move's; a move that sets its own type (Weather Ball, Tera Blast, Judgment, Hidden Power: an `onModifyType` handler), a Z-move, a Max move and any move under Electrify or Ion Deluge are not asked, because the log does not show the type. */
function hitCauseOf(state: InferrerState, watch: BlockedWatch, target: string, effect: SceneEffect): { target: string; causes: Cause[]; unsure?: boolean } | null {
  const pending = state.pendingMove;
  const move = pending ? dexOf(state).moves.get(pending.moveName) : null;
  if (!pending || !move?.exists || move.category === 'Status') return null;
  // A name whose id is another move's (the typed Hidden Powers of the older generations) is the typed alias of a move the twin cannot select by name.
  const open = watch.typeShift || !!move.isZ || !!move.isMax || toId(pending.moveName) !== move.id || Object.keys(move).some(key => /^on\w*ModifyType/.test(key));
  return { target, causes: open ? [] : [{ source: pending.attacker, effect, route: 'primary', move: move.id }], unsure: open };
}

/** The causes of the effect a line shows: a flinch comes of a move that hit the body this turn, a drop after an Intimidate-like announcement of that ability, the rest of the move resolving now. */
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

interface Holder { ident: string; species: string; role: 'self' | 'partner' }

/** What the log shows of the body a hit lands on, which the simulator's hit steps read: its item (Iron Ball grounds a Levitate holder), its types now (Wonder Guard reads them after a Tera or a type change) and its volatiles (Ingrain, Smack Down). The one known hole: a hidden Iron Ball grounds a Levitate holder and the log shows nothing of it. */
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

/** Whether the ability refuses the effect for one cause: the source's abilities are asked one at a time, the candidate first, and it refuses only if every one refuses and the scene with no ability lets the effect land for one (a scene the log contradicts proves nothing). The partner of a body with an open ability stands for its species only, so the scenes of one body's hits share their answers. */
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

function refuses(state: InferrerState, watch: BlockedWatch, holder: Holder, partner: Holder | null, ability: string, causes: Cause[], effectTarget: Holder, hitState: HitState | undefined): boolean {
  return causes.length > 0 && causes.every(cause => refusedFor(state, watch, holder, partner, ability, cause, effectTarget, hitState));
}

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

function allyOf(state: InferrerState, ident: string): string | null {
  const mon = clientPokemon(state, ident);
  const ally = mon?.side.active.find(other => other && other !== mon && !other.fainted);
  // The ident the log writes for the position (the client's own ident is the one without the slot letter).
  return ally ? `${identOf(ident)?.side}${String.fromCharCode(97 + ally.slot)}: ${ally.name}` : null;
}

/** Rules out every candidate the simulator refuses the effect with, never the last legal one; a hit asks only the candidates `mayRefuseHit` names, so the others cost nothing. */
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

function situationOf(state: InferrerState, watch: BlockedWatch, target: string) {
  const own = holderOf(state, watch, target, 'self');
  const species = (ident: string) => clientPokemon(state, ident)?.speciesForme ?? '';
  const effectTarget: Holder = own?.holder ?? { ident: target, species: species(target), role: 'self' };
  const allyIdent = state.hitWalk?.battle.gameType !== 'singles' ? allyOf(state, target) : null;
  const ally = allyIdent ? holderOf(state, watch, allyIdent, 'partner') : null;
  const partner: Holder | null = allyIdent && species(allyIdent) ? { ident: allyIdent, species: species(allyIdent), role: 'partner' } : null;
  return { own, effectTarget, ally, partner };
}

function readable(state: InferrerState): boolean {
  const walk = state.hitWalk;
  return !!walk && !walk.neutralized && dexOf(state).gen >= 3 && !state.freeAbilities;
}

/** Called once per line after the client read it: a flinch, drop, status, volatile or hit that landed on an opponent Pokémon rules out the abilities of that Pokémon and its ally on the field that the simulator refuses it with. */
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
