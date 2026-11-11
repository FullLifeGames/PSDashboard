import { toId } from '../ids.ts';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { effectLands, type EffectScene, type SceneEffect } from '../sim-ask/effect-refusal.ts';
import { clientPokemon } from './client-facts.ts';
import { illusionPossible, possibleAbilities } from './item-evidence.ts';
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
 * could name and every ability the source's species could hold (a Mold Breaker kin sets `ignoreAbility` on the twin's move event, and the
 * battle's own `suppressingAbility` then skips the breakable handlers), and counts as blocked only when it refuses in all of them while
 * the same scene with no ability lets the effect land (a scene the log contradicts proves nothing). The ally of the body is asked too in
 * doubles: Flower Veil, Sweet Veil and the other guards of the `onAlly` kind refuse for their ally.
 * Nothing is ruled out when the log names Neutralizing Gas, when an Illusion user may stand on the team, when the body is transformed,
 * in another forme than its team entry, has its ability suppressed or changed, or when the abilities that refuse the effect are the whole
 * set the species has left (a contradiction: a misread or a rule the simulator lacks, never a proof). `blockedContradictions()` counts the last.
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
}

/** Events where every legal ability of the body would have refused the effect (nothing is ruled out for them), counted over the process. */
let contradictionCount = 0;
export const blockedContradictions = (): number => contradictionCount;

/** One way the line's effect may have reached its target. */
interface Cause { source: string; effect: SceneEffect; route: EffectScene['route']; move?: string; ability?: string }

const BOUNDARIES = new Set(['move', 'switch', 'drag', 'turn', 'upkeep', 'cant', 'faint', 'replace']);

function watchOf(state: InferrerState): BlockedWatch {
  return (state.blockedWatch ??= { hitBy: new Map(), announced: null, suppressed: new Set(), weather: '' });
}

/** The line's bookkeeping: the abilities the log suppressed, the announced Intimidate-like ability, the weather. */
function trackAbilities(state: InferrerState, watch: BlockedWatch, line: LogLine) {
  if (line.cmd === '-weather') watch.weather = arg(line, 1) === 'none' ? '' : dexOf(state).conditions.get(arg(line, 1)).id;
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
  if (line.cmd === '-start' && !hasKw(line, 'fatigue')) return { kind: 'volatile', id: toId(arg(line, 2).replace(/^(move|ability|item): /, '')) };
  return null;
}

/**
 * The causes of the effect a line shows, and the body that took it. A flinch comes of a move that hit the body this turn; a drop that
 * follows an Intimidate-like announcement comes of that ability; the rest come of the move resolving now, by the routes its Dex data has.
 */
function causesOf(state: InferrerState, watch: BlockedWatch, line: LogLine): { target: string; causes: Cause[] } | null {
  const target = arg(line, 1);
  // A line the effect of a move names (`[from] move: Spore` on a status) is the move's own; an item's or an ability's is another source.
  const from = fromEffect(line);
  const effect = effectOf(line);
  if (!target || !effect || (hasKw(line, 'from') && from.type !== 'move')) return null;
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
  const species = state.identSpecies.get(ident) ?? mon?.speciesForme;
  const entry = species ? dexOf(state).species.get(species) : null;
  if (!entry?.exists) return null;
  const names = [...new Set(Object.values(entry.abilities ?? {}) as string[])];
  return names.length ? names : [''];
}

/** What stands in a scene: the species the client shows, the ability the scene names. */
interface Holder { ident: string; species: string; role: 'self' | 'partner' }

/** Whether the ability would have refused the effect in every way the line could have come about, and the scene with none lets it land. */
function refuses(state: InferrerState, weather: string, holder: Holder, partner: Holder | null, ability: string, causes: Cause[], effectTarget: Holder): boolean {
  const dex = dexOf(state);
  return causes.length > 0 && causes.every(cause => {
    const abilities = sourceAbilities(state, cause.source);
    const species = state.identSpecies.get(cause.source) ?? clientPokemon(state, cause.source)?.speciesForme;
    if (!abilities || !species) return false;
    const scene = (given: string, sourceAbility: string): EffectScene => ({
      target: { species: effectTarget.species, ability: holder.role === 'self' ? given : '' },
      partner: partner ? { species: partner.species, ability: holder.role === 'partner' ? given : '' } : undefined,
      source: { species, ability: sourceAbility }, effect: cause.effect, route: cause.route, move: cause.move, ability: cause.ability, weather,
    });
    const consistent = abilities.filter(sourceAbility => effectLands(dex, scene('', sourceAbility)) === true);
    return consistent.length > 0 && consistent.every(sourceAbility => effectLands(dex, scene(ability, sourceAbility)) === false);
  });
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

/** Rules out, for one holder, every candidate ability the simulator refuses the effect with (never the last legal one). */
function ruleOutRefusers(state: InferrerState, watch: BlockedWatch, effectTarget: Holder, found: { holder: Holder; nickname: string }, partner: Holder | null, causes: Cause[]) {
  const candidates = possibleAbilities(state, found.holder.ident);
  if (!candidates || candidates.size === 0) return;
  const dex = dexOf(state);
  const refused = [...candidates].filter(id => refuses(state, watch.weather, found.holder, partner, dex.abilities.get(id).name, causes, effectTarget));
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

/**
 * Called once per line, after the client read it (inferOpponentTeam's loop): a flinch, a drop, a status or a volatile that landed on an
 * opponent Pokémon rules out the abilities of that Pokémon, and of its ally on the field, that the simulator refuses it with.
 */
export function watchBlockedEffects(state: InferrerState, line: LogLine) {
  const watch = watchOf(state);
  track(state, watch, line);
  const walk = state.hitWalk;
  if (!walk || walk.neutralized || dexOf(state).gen < 3 || state.freeAbilities) return;
  const read = causesOf(state, watch, line);
  if (!read || read.causes.length === 0 || identOf(read.target)?.side !== state.opponentSide) return;
  // A cause that is the body itself (Close Combat, a reflected Intimidate) proves nothing about a guard against others.
  if (read.causes.some(cause => keyOf(cause.source) === keyOf(read.target)) || illusionPossible(state)) return;
  const { own, effectTarget, ally, partner } = situationOf(state, watch, read.target);
  if (!effectTarget.species) return;
  if (own) ruleOutRefusers(state, watch, effectTarget, own, partner, read.causes);
  if (ally && partner) ruleOutRefusers(state, watch, effectTarget, ally, partner, read.causes);
}
