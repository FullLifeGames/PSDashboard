import { PRNG, State } from '@pkmn/sim';
import type { Battle, PRNGSeed, Pokemon, Side } from '@pkmn/sim';
import { evaluatePosition } from './eval-function';
import type { TeraAllowance } from './types';

export interface ChoiceOption {
  /** Sim choice string, accepted verbatim by Battle#choose. */
  choice: string;
  label: string;
}

/**
 * Serializes without the sim's wall-clock `|t:|` log lines — they made two
 * identical advances straddling a second boundary serialize differently,
 * breaking position-identity determinism.
 */
export function serializeBattleStable(battle: Battle): string {
  const state = State.serializeBattle(battle) as { log?: string[] };
  if (Array.isArray(state.log)) state.log = state.log.filter(line => !line.startsWith('|t:|'));
  return JSON.stringify(state);
}

/**
 * An immutable battle position. The serialized string is the identity, but it
 * is computed lazily — depth-1 leaf children are only ever evaluated, and
 * serializing them would double the cost of every fork for nothing.
 */
export interface SimPosition {
  readonly serialized: string;
}

/**
 * @pkmn/sim's deserializer walks baseMoveSlots indexing moveSlots to restore
 * slot identity — a transformed mon that copied a PARTIALLY REVEALED target
 * has fewer moveSlots than base, and the walk crashes on the missing tail
 * ("reading 'id'"; Imprison-Transform Mew, gen9doublesou-2660802611). Pad a
 * parsed copy up to base length, deserialize, trim the live arrays back —
 * the battle round-trips exactly and the original string stays the cache key.
 */
function deserializeRepaired(serialized: string): Battle {
  const state = JSON.parse(serialized) as {
    sides?: { pokemon?: { moveSlots?: unknown[]; baseMoveSlots?: unknown[] }[] }[];
  };
  const trims: { side: number; index: number; length: number }[] = [];
  state.sides?.forEach((side, sideIndex) => side.pokemon?.forEach((pokemon, index) => {
    const base = pokemon.baseMoveSlots;
    const slots = pokemon.moveSlots;
    if (!Array.isArray(base) || !Array.isArray(slots) || base.length <= slots.length) return;
    trims.push({ side: sideIndex, index, length: slots.length });
    while (slots.length < base.length) slots.push(base[slots.length]);
  }));
  const battle = State.deserializeBattle(state as never);
  for (const trim of trims) {
    battle.sides[trim.side].pokemon[trim.index].moveSlots.length = trim.length;
  }
  // Correction-era invariant drift (GPL T38/T39): snapshot corrections set
  // hp/fainted per mon without maintaining side.pokemonLeft — the win-check
  // counter, so a wiped side played on behind a stale move request — or
  // isActive, so the bench enumeration offered "switch 1" onto the active.
  // Restore both from ground truth on every deserialize.
  for (const side of battle.sides) {
    side.pokemonLeft = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0).length;
    for (const pokemon of side.pokemon) {
      pokemon.isActive = side.active.includes(pokemon);
    }
  }
  return battle;
}

class Position implements SimPosition {
  private serializedCache: string | null;
  private battleCache: Battle | null;

  constructor(serialized: string | null, battle: Battle | null) {
    this.serializedCache = serialized;
    this.battleCache = battle;
  }

  get serialized(): string {
    this.serializedCache ??= serializeBattleStable(this.battleCache!);
    return this.serializedCache;
  }

  getBattle(): Battle {
    if (!this.battleCache) {
      this.battleCache = deserializeRepaired(this.serializedCache!);
      repairFaintedActives(this.battleCache);
    }
    return this.battleCache;
  }
}

/** Fallback cache for foreign `{ serialized }` literals. */
const foreignBattleCache = new WeakMap<SimPosition, Battle>();

export function createRootPosition(serializedBattle: string): SimPosition {
  return new Position(serializedBattle, null);
}

/** Cached read-only deserialization — never mutate the returned battle. */
export function positionBattle(position: SimPosition): Battle {
  if (position instanceof Position) return position.getBattle();
  let battle = foreignBattleCache.get(position);
  if (!battle) {
    battle = deserializeRepaired(position.serialized);
    foreignBattleCache.set(position, battle);
  }
  return battle;
}

function toPosition(battle: Battle): SimPosition {
  return new Position(null, battle);
}

const choiceKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function sideIndex(side: 'p1' | 'p2'): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}

/** Move target types that require picking a foe slot in doubles. */
const TARGET_FOE = new Set(['normal', 'any', 'adjacentFoe']);

interface SlotChoice {
  choice: string;
  label: string;
  /** Uses a once-per-battle gimmick (Tera / Mega / Ultra) this turn. */
  once: boolean;
  /** Bench slot for switches (duplicate-target exclusion), null for moves. */
  bench: number | null;
}

interface ActiveRequestSlot {
  moves: { move: string; disabled?: unknown; target?: unknown }[];
  trapped?: unknown;
  canTerastallize?: unknown;
  canMegaEvo?: unknown;
  canUltraBurst?: unknown;
}

function benchSwitches(sideState: Side): SlotChoice[] {
  const switches: SlotChoice[] = [];
  sideState.pokemon.forEach((pokemon, index) => {
    if (pokemon.isActive || pokemon.fainted) return;
    // Species, not nickname — labels feed the analysis text and PVs.
    switches.push({ choice: `switch ${index + 1}`, label: `→ ${pokemon.species.name}`, once: false, bench: index + 1 });
  });
  return switches;
}

/** All choices one doubles slot can make on its own. */
function slotChoicesFor(
  sideState: Side,
  entry: ActiveRequestSlot | null | undefined,
  forced: boolean,
  slot: number,
  allowTera: boolean,
): SlotChoice[] {
  if (forced) return benchSwitches(sideState);
  const pokemon = sideState.active[slot];
  if (!entry || !pokemon || pokemon.fainted) return [];

  const trapped = 'trapped' in entry && !!entry.trapped;
  const canTera = allowTera && !!entry.canTerastallize;
  const canMega = !!entry.canMegaEvo;
  const canUltra = !!entry.canUltraBurst;
  const choices: SlotChoice[] = [];
  const foeActives = sideState.foe.active;
  // Requests conceal 'hidden' disables (Imprison — the player learns when the
  // click bounces), but the analyzer holds the full state: a concealed-disabled
  // candidate is a guaranteed choice reject that kills the whole search.
  const liveDisabled = new Set<string>(pokemon.moveSlots.filter(slot => slot.disabled).map(slot => slot.id));

  for (const move of entry.moves) {
    if ('disabled' in move && move.disabled) continue;
    const key = choiceKey(move.move);
    if (liveDisabled.has(key)) continue;
    // Locked requests (mid-charge Phantom Force, rampages) carry no target
    // data. The LIVE sim auto-targets a bare release, but serialization
    // drops the locked-request shape and the round-tripped sim demands a
    // target again ("Phantom Force needs a target", gen9doublesou t6/t8) —
    // and every advance here runs on a round-trip. Fall back to the dex's
    // target type: foe-targeting releases enumerate slots, random-target
    // rampages (Outrage) stay bare.
    const targetType = 'target' in move
      ? (move.target as string | undefined)
      : sideState.battle.dex.moves.get(key).target;
    const targets: { suffix: string; label: string }[] = [];
    if (targetType && TARGET_FOE.has(targetType)) {
      const living = foeActives
        .map((foe, index) => ({ foe, index }))
        .filter(({ foe }) => foe && !foe.fainted);
      if (living.length > 1) {
        for (const { foe, index } of living) {
          targets.push({ suffix: ` ${index + 1}`, label: `${move.move}→${foe!.species.name}` });
        }
      } else if (living.length === 1) {
        targets.push({ suffix: ` ${living[0].index + 1}`, label: move.move });
      } else {
        targets.push({ suffix: '', label: move.move });
      }
    } else if (targetType === 'adjacentAlly') {
      targets.push({ suffix: ` -${slot === 0 ? 2 : 1}`, label: move.move });
    } else if (targetType === 'adjacentAllyOrSelf') {
      targets.push({ suffix: ` -${slot + 1}`, label: move.move });
    } else {
      targets.push({ suffix: '', label: move.move });
    }
    for (const target of targets) {
      choices.push({ choice: `move ${key}${target.suffix}`, label: target.label, once: false, bench: null });
      if (canTera) {
        choices.push({
          choice: `move ${key}${target.suffix} terastallize`,
          label: `Tera + ${target.label}`,
          once: true,
          bench: null,
        });
      }
      if (canMega) {
        choices.push({ choice: `move ${key}${target.suffix} mega`, label: `Mega + ${target.label}`, once: true, bench: null });
      }
      if (canUltra) {
        choices.push({ choice: `move ${key}${target.suffix} ultra`, label: `Ultra + ${target.label}`, once: true, bench: null });
      }
    }
  }

  if (!trapped) choices.push(...benchSwitches(sideState));
  return choices;
}

/** Per-Pokémon Tera check: draft allowances list the species holding rights. */
function teraAllowed(tera: TeraAllowance | undefined, side: 'p1' | 'p2', pokemon: Pokemon | null): boolean {
  if (tera === undefined || tera === true) return true;
  if (tera === false || !pokemon) return false;
  const list = tera[side];
  return list.includes(pokemon.species.name) || list.includes(pokemon.species.baseSpecies);
}

export function legalChoices(
  position: SimPosition,
  side: 'p1' | 'p2',
  opts?: { tera?: TeraAllowance },
): ChoiceOption[] {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const request = sideState.activeRequest;
  if (!request || battle.ended) return [];
  // Mid-forced-switch positions: the OTHER side resolves its replacement,
  // this side cannot act at all — inventing bench switches here made the
  // sim reject them with "It's not your turn". The sentinel never reaches
  // the sim (applyChoice skips it).
  if ('wait' in request && request.wait) {
    return [{ choice: 'wait', label: '(waiting)' }];
  }
  // Team preview (turn 0): the lead choice is a real simultaneous decision.
  // Doubles offers every unordered lead pair, singles every lead; the sim
  // autocompletes the back order from the remaining slots. Digit lists stay
  // unambiguous because teams never exceed 6.
  if ('teamPreview' in request && request.teamPreview) {
    const pool = sideState.pokemon;
    const options: ChoiceOption[] = [];
    if (battle.gameType === 'doubles') {
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          options.push({
            choice: `team ${i + 1}${j + 1}`,
            label: `Lead ${pool[i].species.name} + ${pool[j].species.name}`,
          });
        }
      }
    } else {
      pool.forEach((pokemon, index) => {
        options.push({ choice: `team ${index + 1}`, label: `Lead ${pokemon.species.name}` });
      });
    }
    return options;
  }

  const actives = 'active' in request ? request.active ?? [] : [];
  const forceSwitch = 'forceSwitch' in request ? request.forceSwitch ?? [] : [];
  const slotCount = Math.max(actives.length, forceSwitch.length);

  if (slotCount > 1) {
    // Doubles: per-slot choices, then the combined product. Slots the sim
    // auto-passes (fainted/empty) are skipped entirely — explicit `pass`
    // trips "more choices than unfainted Pokémon".
    const perSlot: SlotChoice[][] = [];
    for (let slot = 0; slot < slotCount; slot++) {
      const slotTera = teraAllowed(opts?.tera, side, sideState.active[slot] ?? null);
      const slotChoices = slotChoicesFor(sideState, actives[slot], !!forceSwitch[slot], slot, slotTera);
      if (slotChoices.length > 0) perSlot.push(slotChoices);
    }
    if (perSlot.length === 0) return [];
    if (perSlot.length === 1) return perSlot[0].map(({ choice, label }) => ({ choice, label }));
    const combined: ChoiceOption[] = [];
    for (const first of perSlot[0]) {
      for (const second of perSlot[1]) {
        if (first.once && second.once) continue; // one Tera/Mega/Ultra per side per turn
        if (first.bench !== null && first.bench === second.bench) continue; // same bench target
        combined.push({ choice: `${first.choice}, ${second.choice}`, label: `${first.label} + ${second.label}` });
      }
    }
    return combined;
  }

  const options: ChoiceOption[] = [];
  const active = 'active' in request ? request.active?.[0] : undefined;
  const forced = 'forceSwitch' in request && !!request.forceSwitch?.[0];
  const trapped = !!active && 'trapped' in active && !!active.trapped;

  if (active && !forced) {
    const activeTera = teraAllowed(opts?.tera, side, sideState.active[0] ?? null);
    // Mirror slotChoicesFor: requests conceal 'hidden' disables (Imprison).
    const liveDisabled = new Set<string>(
      (sideState.active[0]?.moveSlots ?? []).filter(slot => slot.disabled).map(slot => slot.id));
    for (const move of active.moves) {
      if ('disabled' in move && move.disabled) continue;
      if (liveDisabled.has(choiceKey(move.move))) continue;
      options.push({ choice: `move ${choiceKey(move.move)}`, label: move.move });
      if (activeTera && 'canTerastallize' in active && active.canTerastallize) {
        options.push({
          choice: `move ${choiceKey(move.move)} terastallize`,
          label: `Tera + ${move.move}`,
        });
      }
      if ('canMegaEvo' in active && active.canMegaEvo) {
        options.push({ choice: `move ${choiceKey(move.move)} mega`, label: `Mega + ${move.move}` });
      }
      if ('canUltraBurst' in active && active.canUltraBurst) {
        options.push({ choice: `move ${choiceKey(move.move)} ultra`, label: `Ultra + ${move.move}` });
      }
    }
  }

  if (forced || !trapped) {
    sideState.pokemon.forEach((pokemon, index) => {
      if (pokemon.isActive || pokemon.fainted) return;
      options.push({ choice: `switch ${index + 1}`, label: `→ ${pokemon.species.name}` });
    });
  }

  return options;
}

const REPAIR_SEED: PRNGSeed = '1,2,3,4';

/**
 * Snapshot corrections can faint an active without updating the request
 * (rare diverged reconstructions). The sim then auto-passes the dead slot
 * and rejects every choice with "more choices than unfainted Pokémon".
 * Repair: flag the corpse for replacement, regenerate a proper switch
 * request, and greedily resolve it to a clean turn boundary. Deterministic,
 * so every fork of the same serialized string repairs identically.
 */
function repairFaintedActives(battle: Battle): void {
  if (battle.ended) return;
  const stale = battle.sides
    .slice(0, 2)
    .filter(side => side.requestState === 'move' &&
      side.active.some(active => active?.fainted) &&
      // Without a living bench there is nothing to send in — the sim
      // auto-passes the dead slot, so a switch request would only wedge.
      side.pokemon.some(pokemon => !pokemon.isActive && !pokemon.fainted));
  if (stale.length === 0) return;
  for (const side of stale) {
    for (const active of side.active) {
      if (active?.fainted) active.switchFlag = true;
    }
  }
  battle.makeRequest('switch');
  resolveForcedSwitches(battle, REPAIR_SEED);
}

/**
 * Deserializes a fresh copy of the position and seeds its PRNG so the
 * advance is reproducible.
 */
function forkBattle(position: SimPosition, seed: PRNGSeed): Battle {
  const battle = deserializeRepaired(position.serialized);
  battle.prng = new PRNG(seed);
  repairFaintedActives(battle);
  return battle;
}

function applyChoice(battle: Battle, side: 'p1' | 'p2', choice: string): void {
  // The waiting-side sentinel (see legalChoices): nothing to submit.
  if (choice === 'wait') return;
  // Pivot pairs carry their follow-up after ' > ' — the move submits now,
  // the follow-up answers the forced-switch request in resolveForcedSwitches.
  [choice] = choice.split(' > ');
  if (!battle.choose(side, choice)) {
    const error = battle.sides[sideIndex(side)].choice.error || 'choice rejected';
    throw new Error(`${side} "${choice}": ${error}`);
  }
}

/**
 * Resolves any open forced-switch requests (mid-turn KOs) by greedily
 * picking the replacement whose entry statically evaluates best for the
 * choosing side. Runs until the battle is back at a turn boundary or over.
 */
/**
 * All ways to assign distinct bench replacements to the forced slots, as
 * ready-to-send choice strings. With fewer replacements than forced slots
 * the remainder passes.
 */
function switchAssignments(forcedCount: number, benchSlots: number[]): string[] {
  if (forcedCount <= 1) return benchSlots.map(slot => `switch ${slot}`);
  const assignments: string[] = [];
  if (benchSlots.length === 1) {
    return [`switch ${benchSlots[0]}, pass`, `pass, switch ${benchSlots[0]}`];
  }
  for (const first of benchSlots) {
    for (const second of benchSlots) {
      if (first === second) continue;
      assignments.push(`switch ${first}, switch ${second}`);
    }
  }
  return assignments;
}

function resolveForcedSwitches(
  battle: Battle,
  seed: PRNGSeed,
  followUps: { p1?: string; p2?: string } = {},
): void {
  for (let guard = 0; guard < 6; guard++) {
    if (battle.ended) return;
    const pending = battle.sides
      .slice(0, 2)
      .filter(side => side.requestState === 'switch' && !side.isChoiceDone());
    if (pending.length === 0) return;

    const midTurn = serializeBattleStable(battle);
    for (const side of pending) {
      const request = side.activeRequest as { forceSwitch?: boolean[] } | null;
      const forcedCount = Math.max(1, (request?.forceSwitch ?? []).filter(Boolean).length);
      // A pivot pair's declared follow-up answers this side's first switch
      // request. Consumed once; a reject (target dragged/fainted mid-turn)
      // falls back to the greedy resolution below.
      const followUp = followUps[side.id as 'p1' | 'p2'];
      if (followUp && forcedCount === 1) {
        delete followUps[side.id as 'p1' | 'p2'];
        if (battle.choose(side.id as 'p1' | 'p2', followUp)) continue;
        side.clearChoice();
      }
      const benchSlots = side.pokemon
        .map((pokemon, index) => ({ pokemon, slot: index + 1 }))
        .filter(({ pokemon }) => !pokemon.isActive && !pokemon.fainted)
        .map(({ slot }) => slot);
      if (benchSlots.length === 0) continue;

      const assignments = switchAssignments(forcedCount, benchSlots);
      let best = assignments[0];
      if (assignments.length > 1) {
        const perspective = side.id === 'p1' ? 1 : -1;
        let bestValue = -Infinity;
        for (const candidate of assignments) {
          const trial = deserializeRepaired(midTurn);
          trial.prng = new PRNG(seed);
          if (!trial.choose(side.id as 'p1' | 'p2', candidate)) continue;
          const value = perspective * evaluatePosition(trial);
          if (value > bestValue) {
            bestValue = value;
            best = candidate;
          }
        }
      }
      applyChoice(battle, side.id as 'p1' | 'p2', best);
    }
  }
}

/**
 * Advances one full turn under a fixed seed. The returned position is at a
 * normal turn boundary or game end; the input position is never mutated.
 */
export function advancePosition(
  position: SimPosition,
  p1Choice: string,
  p2Choice: string,
  seed: PRNGSeed,
): SimPosition {
  const battle = forkBattle(position, seed);
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  resolveForcedSwitches(battle, seed, {
    p1: p1Choice.split(' > ')[1],
    p2: p2Choice.split(' > ')[1],
  });
  return toPosition(battle);
}
