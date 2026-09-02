import type { Battle, Pokemon, Side } from '@pkmn/sim';
import type { TeraAllowance } from '../types';
import { choiceKey, sideIndex } from './ids';
import { positionBattle, type ChoiceOption, type SimPosition } from './position';

/**
 * The legal choices of one side at a position: team preview leads, the
 * doubles slot product, and the singles list — every consumer enumerates
 * through legalChoices so all engines see the same lists.
 */

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

/** The move id the sim accepts: the entry's id when present, else the display name's key. */
function requestMoveKey(move: ActiveRequestSlot['moves'][number]): string {
  // Happiness moves display with computed BP ("Return 102") — the entry's
  // id is the token the sim accepts; the display name is only the label.
  const id = 'id' in move ? (move as { id?: string }).id : undefined;
  return id || choiceKey(move.move);
}

/** The once-per-battle gimmicks the request offers this slot. */
function slotGimmicks(entry: ActiveRequestSlot, allowTera: boolean): { canTera: boolean; canMega: boolean; canUltra: boolean } {
  return {
    canTera: allowTera && !!entry.canTerastallize,
    canMega: !!entry.canMegaEvo,
    canUltra: !!entry.canUltraBurst,
  };
}

/** The target suffixes (and labels) one move enumerates from a doubles slot: foe slots, ally, self, or bare. */
function moveTargets(
  sideState: Side,
  move: ActiveRequestSlot['moves'][number],
  key: string,
  slot: number,
): { suffix: string; label: string }[] {
  const foeActives = sideState.foe.active;
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
  return targets;
}

/** One target's plain choice plus its once-per-battle gimmick variants. */
function pushSlotChoices(
  choices: SlotChoice[],
  key: string,
  target: { suffix: string; label: string },
  gimmicks: { canTera: boolean; canMega: boolean; canUltra: boolean },
): void {
  choices.push({ choice: `move ${key}${target.suffix}`, label: target.label, once: false, bench: null });
  if (gimmicks.canTera) {
    choices.push({
      choice: `move ${key}${target.suffix} terastallize`,
      label: `Tera + ${target.label}`,
      once: true,
      bench: null,
    });
  }
  if (gimmicks.canMega) {
    choices.push({ choice: `move ${key}${target.suffix} mega`, label: `Mega + ${target.label}`, once: true, bench: null });
  }
  if (gimmicks.canUltra) {
    choices.push({ choice: `move ${key}${target.suffix} ultra`, label: `Ultra + ${target.label}`, once: true, bench: null });
  }
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

  // Requests also conceal 'hidden' TRAPPING (an unrevealed Magnet Pull) while
  // the switch validation still rejects — consult the live field like the
  // liveDisabled rule below (573756 t24/32/38-40 died on offered switches).
  const trapped = ('trapped' in entry && !!entry.trapped) || !!pokemon.trapped;
  const gimmicks = slotGimmicks(entry, allowTera);
  const choices: SlotChoice[] = [];
  // Requests conceal 'hidden' disables (Imprison — the player learns when the
  // click bounces), but the analyzer holds the full state: a concealed-disabled
  // candidate is a guaranteed choice reject that kills the whole search.
  const liveDisabled = new Set<string>(pokemon.moveSlots.filter(slot => slot.disabled).map(slot => slot.id));

  for (const move of entry.moves) {
    if ('disabled' in move && move.disabled) continue;
    const key = requestMoveKey(move);
    if (liveDisabled.has(key)) continue;
    for (const target of moveTargets(sideState, move, key, slot)) {
      pushSlotChoices(choices, key, target, gimmicks);
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

type ActiveRequest = NonNullable<Side['activeRequest']>;

/**
 * Team preview (turn 0): the lead choice is a real simultaneous decision.
 * Doubles offers every unordered lead pair, singles every lead; the sim
 * autocompletes the back order from the remaining slots. Digit lists stay
 * unambiguous because teams never exceed 6.
 */
function teamPreviewChoices(battle: Battle, sideState: Side): ChoiceOption[] {
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

/** The combined product of two slots: one Tera/Mega/Ultra per side per turn, distinct bench targets. */
function combineSlots(perSlot: SlotChoice[][]): ChoiceOption[] {
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

/**
 * Doubles: per-slot choices, then the combined product. Slots the sim
 * auto-passes (fainted/empty) are skipped entirely — explicit `pass`
 * trips "more choices than unfainted Pokémon".
 */
function doublesChoices(
  sideState: Side,
  actives: (ActiveRequestSlot | null | undefined)[],
  forceSwitch: boolean[],
  slotCount: number,
  side: 'p1' | 'p2',
  tera: TeraAllowance | undefined,
): ChoiceOption[] {
  const perSlot: SlotChoice[][] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const slotTera = teraAllowed(tera, side, sideState.active[slot] ?? null);
    const slotChoices = slotChoicesFor(sideState, actives[slot], !!forceSwitch[slot], slot, slotTera);
    if (slotChoices.length > 0) perSlot.push(slotChoices);
  }
  if (perSlot.length === 0) return [];
  if (perSlot.length === 1) return perSlot[0].map(({ choice, label }) => ({ choice, label }));
  return combineSlots(perSlot);
}

/** A singles move's gimmick variants, after the plain choice. */
function pushSinglesGimmicks(
  options: ChoiceOption[],
  key: string,
  move: ActiveRequestSlot['moves'][number],
  active: ActiveRequestSlot,
  activeTera: boolean,
): void {
  if (activeTera && 'canTerastallize' in active && active.canTerastallize) {
    options.push({
      choice: `move ${key} terastallize`,
      label: `Tera + ${move.move}`,
    });
  }
  if ('canMegaEvo' in active && active.canMegaEvo) {
    options.push({ choice: `move ${key} mega`, label: `Mega + ${move.move}` });
  }
  if ('canUltraBurst' in active && active.canUltraBurst) {
    options.push({ choice: `move ${key} ultra`, label: `Ultra + ${move.move}` });
  }
}

/** The singles active's moves with their gimmick variants. */
function singlesMoveChoices(
  sideState: Side,
  active: ActiveRequestSlot,
  side: 'p1' | 'p2',
  tera: TeraAllowance | undefined,
  options: ChoiceOption[],
): void {
  const activeTera = teraAllowed(tera, side, sideState.active[0] ?? null);
  // Mirror slotChoicesFor: requests conceal 'hidden' disables (Imprison).
  const liveDisabled = new Set<string>(
    (sideState.active[0]?.moveSlots ?? []).filter(slot => slot.disabled).map(slot => slot.id));
  for (const move of active.moves) {
    if ('disabled' in move && move.disabled) continue;
    // Same id-over-display-name rule as slotChoicesFor ("Return 102" -> return).
    const key = requestMoveKey(move);
    if (liveDisabled.has(key)) continue;
    options.push({ choice: `move ${key}`, label: move.move });
    pushSinglesGimmicks(options, key, move, active, activeTera);
  }
}

/** Singles: the active's moves (unless forced), then the bench (when forced or not trapped). */
function singlesChoices(
  request: ActiveRequest,
  sideState: Side,
  side: 'p1' | 'p2',
  tera: TeraAllowance | undefined,
): ChoiceOption[] {
  const options: ChoiceOption[] = [];
  const active = 'active' in request ? request.active?.[0] : undefined;
  const forced = 'forceSwitch' in request && !!request.forceSwitch?.[0];
  // Same rule as slotChoicesFor: requests conceal 'hidden' trapping (an
  // unrevealed Magnet Pull) — the live field is what the validation checks.
  const trapped = !!active && (('trapped' in active && !!active.trapped) || !!sideState.active[0]?.trapped);

  if (active && !forced) singlesMoveChoices(sideState, active, side, tera, options);

  if (forced || !trapped) {
    sideState.pokemon.forEach((pokemon, index) => {
      if (pokemon.isActive || pokemon.fainted) return;
      options.push({ choice: `switch ${index + 1}`, label: `→ ${pokemon.species.name}` });
    });
  }

  return options;
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
  if ('teamPreview' in request && request.teamPreview) return teamPreviewChoices(battle, sideState);

  const actives = 'active' in request ? request.active ?? [] : [];
  const forceSwitch = 'forceSwitch' in request ? request.forceSwitch ?? [] : [];
  const slotCount = Math.max(actives.length, forceSwitch.length);
  if (slotCount > 1) return doublesChoices(sideState, actives, forceSwitch, slotCount, side, opts?.tera);
  return singlesChoices(request, sideState, side, opts?.tera);
}
