import { Battle } from '@pkmn/client';
import type { HitParty, LoggedHit } from '../types.ts';
import { generationsFor } from '../format-generations.ts';
import type { ClientIdent } from '../protocol/parser-state.ts';
import { Protocol } from '@pkmn/protocol';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import { illusionPossible } from './item-evidence.ts';
import { arg, hasKw, identOf, keyOf, namesEffect, ofIdent, type LogLine } from './log-line.ts';
import { toId } from '../ids.ts';

/**
 * The clean hits each opponent Pokémon dealt (round 67, T130): the damage
 * judge (team/item-damage.ts) recomputes them per item candidate. The
 * inference walks the log with its own @pkmn/client Battle (spec decision
 * 19: one client per inference) and reads, just before each damage line,
 * what the calculator needs: both parties' formes, levels, Tera, boosts,
 * status and HP, the weather, the terrain, the screens, Helping Hand, the
 * other Pokémon on the field, and whether the move line names spread
 * targets. A hit counts once per target: a second damage line from the same
 * move (multi-hit, Parental Bond) drops it, as do crits and every
 * [from]-attributed line. Singles and doubles alike: unlike the parser's
 * damage observations (singles only, the spread solver's input), these feed
 * only the item judge.
 */

type ClientPokemon = NonNullable<ReturnType<Battle['getPokemon']>>;

const SCREEN_IDS = ['reflect', 'lightscreen', 'auroraveil'];
/** The client's marks for an item a Pokémon took from another one. */
const ACQUIRED = new Set(['tricked', 'stolen', 'bestowed', 'harvested']);
/** Lines after which no move is resolving ('' a blank line, "done" the "|" line). */
const ACTION_ENDS = new Set(['', 'done', 'move', 'switch', 'drag', 'cant', 'turn', 'upkeep']);
/** Moves that swap stats the calculator cannot see. */
const STAT_SWAPS = new Set(['Power Split', 'Guard Split']);

/** A hit on one target of the resolving move; `lines` counts its damage lines. */
interface TargetHit {
  hit: LoggedHit;
  lines: number;
}

/** The resolving move of an opponent attacker. */
interface PendingMove {
  attacker: string;
  move: string;
  spread: boolean;
  crits: Set<string>;
  targets: Map<string, TargetHit>;
}

export interface HitWalk {
  battle: Battle;
  pending: PendingMove | null;
  /** Clean hits per opponent attacker ("p2: Nick"). */
  hits: Map<string, LoggedHit[]>;
  /** Pokémon whose stats a Power Split, Guard Split or Power Trick changed since they entered. */
  swapped: Set<string>;
  /** Neutralizing Gas appeared: from then on any ability may be off. */
  neutralized: boolean;
  format: string;
}

function newWalk(state: InferrerState): HitWalk {
  const tierLine = state.lines.find(line => line.cmd === 'tier');
  const tier = tierLine ? arg(tierLine, 1) : '';
  return { battle: new Battle(generationsFor(tier)), pending: null, hits: new Map(), swapped: new Set(), neutralized: false, format: tier };
}

/** The stat an active Protosynthesis or Quark Drive raises: the client keeps it on the volatile ('protosynthesis' or 'quarkdrive', `stat` 'atk'). */
function boostedStatOf(mon: ClientPokemon): string {
  const volatile = mon.volatiles.protosynthesis ?? mon.volatiles.quarkdrive;
  const stat = (volatile as { stat?: unknown } | undefined)?.stat;
  return typeof stat === 'string' ? stat : '';
}

function party(mon: ClientPokemon): HitParty {
  return {
    species: mon.speciesForme, level: mon.level, tera: mon.terastallized || undefined,
    boosts: { ...mon.boosts } as Record<string, number>, status: mon.status ?? '',
    hp: mon.maxhp > 0 ? mon.hp / mon.maxhp : 1, ability: mon.ability ?? '',
    held: mon.item ?? '', itemChanged: !!mon.lastItem || ACQUIRED.has(mon.itemEffect),
    gender: mon.gender === 'M' || mon.gender === 'F' ? mon.gender : '',
    alliesFainted: mon.side.team.filter(member => member.fainted).length,
    flashFire: !!mon.volatiles.flashfire, slowStart: !!mon.volatiles.slowstart, boostedStat: boostedStatOf(mon),
    charged: !!mon.volatiles.charge,
  };
}

/** What the calculator cannot reproduce from the record at this hit; '' when nothing. */
function doubtOf(walk: HitWalk, attacker: ClientPokemon, defender: ClientPokemon): string {
  const pseudo = walk.battle.field.pseudoWeather as Record<string, unknown>;
  if (walk.neutralized) return 'neutralizing gas';
  if (pseudo.magicroom) return 'magic room';
  if (pseudo.wonderroom) return 'wonder room';
  for (const mon of [attacker, defender]) {
    if (mon.volatiles.transform) return 'transform';
    if (mon.volatiles.dynamax) return 'dynamax';
    if (walk.swapped.has(keyOf(mon.ident))) return 'stat swap';
  }
  return attacker.volatiles.embargo ? 'embargo' : '';
}

/** The hit as the client stands just before its damage line applies. */
function recordHit(walk: HitWalk, pending: PendingMove, attacker: ClientPokemon, defender: ClientPokemon, gen: number): LoggedHit {
  const { battle } = walk;
  const sideConditions = defender.side.sideConditions as Record<string, unknown>;
  const others = [...battle.p1.active, ...battle.p2.active]
    .filter((mon): mon is ClientPokemon => !!mon && mon !== attacker && mon !== defender && !mon.fainted)
    .map(mon => ({ species: mon.speciesForme, ability: mon.ability ?? '' }));
  return {
    move: pending.move, attacker: party(attacker),
    defender: { ...party(defender), side: defender.side.n === 0 ? 'p1' : 'p2' },
    observed: 0, lowerBound: false,
    weather: battle.field.weather ?? '', terrain: battle.field.terrain ?? '',
    screens: SCREEN_IDS.filter(id => sideConditions[id]),
    helpingHand: !!attacker.volatiles.helpinghand, defenderNew: defender.newlySwitched,
    doubles: battle.gameType !== 'singles', spread: pending.spread, others,
    doubt: doubtOf(walk, attacker, defender), gen, format: walk.format,
  };
}

/** A damage line of the resolving move, read before it applies: the first opens the target's hit, a second spoils it. */
function noteDamage(walk: HitWalk, line: LogLine, gen: number) {
  const pending = walk.pending;
  const target = arg(line, 1);
  if (!pending || target === pending.attacker) return;
  const known = pending.targets.get(target);
  if (known) {
    known.lines += 1;
    return;
  }
  const attacker = walk.battle.getPokemon(pending.attacker as ClientIdent);
  const defender = walk.battle.getPokemon(target as ClientIdent);
  if (!attacker || !defender || pending.crits.has(target)) return;
  pending.targets.set(target, { hit: recordHit(walk, pending, attacker, defender, gen), lines: 1 });
}

/** The same damage line after it applied: the HP it left and whether that reading is only a floor. */
function settleDamage(walk: HitWalk, line: LogLine) {
  const entry = walk.pending?.targets.get(arg(line, 1));
  const defender = walk.battle.getPokemon(arg(line, 1) as ClientIdent);
  if (!entry || entry.lines !== 1 || !defender || defender.maxhp <= 0) return;
  const after = defender.hp / defender.maxhp;
  entry.hit.observed = entry.hit.defender.hp - after;
  // A knock-out, or the lowest HP the log can show (a Focus Sash, Sturdy, Endure): the move did at least this much.
  entry.hit.lowerBound = after === 0 || defender.hp === 1;
}

/** The move ended: each target hit once, without a crit, with damage, becomes a clean hit of its attacker. */
function closeMove(walk: HitWalk) {
  const pending = walk.pending;
  walk.pending = null;
  if (!pending) return;
  const key = keyOf(pending.attacker);
  for (const entry of pending.targets.values()) {
    if (entry.lines !== 1 || !(entry.hit.observed > 0)) continue;
    walk.hits.set(key, [...(walk.hits.get(key) ?? []), entry.hit]);
  }
}

/** Stat swaps the calculator cannot see stay with both Pokémon until they leave the field. */
function noteSwaps(walk: HitWalk, line: LogLine) {
  if (line.cmd === 'switch' || line.cmd === 'drag') walk.swapped.delete(keyOf(arg(line, 1)));
  const effect = Protocol.parseEffect(arg(line, 2));
  const swap = (effect.type === 'move' && STAT_SWAPS.has(effect.name)) || line.args.slice(1).some(value => value === 'Power Trick');
  if (!swap) return;
  for (const ident of [arg(line, 1), ofIdent(line)]) if (ident) walk.swapped.add(keyOf(ident));
}

/**
 * The line handler: closes the resolving move at each action boundary,
 * opens a move of the opponent side, records the hits of its damage lines,
 * and feeds the line to the client.
 */
/** A line of the resolving move: an opponent's move opens it, a crit marks its target, a plain damage line opens a hit. */
function noteMoveLine(walk: HitWalk, state: InferrerState, line: LogLine) {
  if (line.cmd === 'move' && identOf(arg(line, 1))?.side === state.opponentSide) {
    walk.pending = { attacker: arg(line, 1), move: toId(arg(line, 2)), spread: hasKw(line, 'spread'), crits: new Set(), targets: new Map() };
  } else if (line.cmd === '-crit' && walk.pending) {
    walk.pending.crits.add(arg(line, 1));
  } else if (line.cmd === '-damage' && !hasKw(line, 'from')) {
    noteDamage(walk, line, state.gen);
  }
}

export function collectHits(state: InferrerState, line: LogLine) {
  const walk = (state.hitWalk ??= newWalk(state));
  if (ACTION_ENDS.has(line.cmd)) closeMove(walk);
  noteMoveLine(walk, state, line);
  noteSwaps(walk, line);
  if (namesEffect(line, 'Neutralizing Gas')) walk.neutralized = true;
  try {
    // The client reads the same parse; copies, so its handlers cannot change what the next handler reads.
    walk.battle.add([...line.args] as Protocol.ArgType, { ...line.kwArgs } as Protocol.BattleArgsKWArgType);
  } catch {
    // A line the client cannot apply (a synthetic log's impossible order) is skipped, as the parser does.
  }
  if (line.cmd === '-damage' && !hasKw(line, 'from')) settleDamage(walk, line);
}

/**
 * At the end of the walk the hits go onto their attackers' infos. A team that
 * may hold an Illusion user gets none: any attacker could be the disguise.
 */
export function attachHits(state: InferrerState) {
  const walk = state.hitWalk;
  if (!walk) return;
  closeMove(walk);
  if (illusionPossible(state)) return;
  for (const [key, hits] of walk.hits) {
    const pokemon = findPokemon(state, key.slice(4));
    if (pokemon) pokemon.hits = [...(pokemon.hits ?? []), ...hits];
  }
}
