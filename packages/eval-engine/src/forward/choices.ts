import type { Battle, Pokemon, Side } from '@pkmn/sim';
import type { TeraAllowance } from '../types.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from './position.ts';
import { switchAssignments } from './assignments.ts';
import { switchInSlots } from './switches.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';
import { isLockedEntry, nextChoosingSlot, requestMoveKey, type RequestMove } from './request-moves.ts';

const TARGET_FOE = new Set(['normal', 'any', 'adjacentFoe']);

/** The played actions of a side's slots; a move aimed at the own partner names its location (negative). */
export type PlayedSlots = readonly ({ kind: string; name: string; targetLoc?: number | null } | null)[];

interface SlotChoice {
  choice: string;
  label: string;
  once: boolean;
  bench: number | null;
}

interface ActiveRequestSlot {
  moves: RequestMove[];
  trapped?: unknown;
  canTerastallize?: unknown;
  canMegaEvo?: unknown;
  canUltraBurst?: unknown;
  canDynamax?: unknown;
  canZMove?: unknown;
}

function benchSwitches(sideState: Side): SlotChoice[] {
  // Species, not nickname: labels feed the analysis text and PVs.
  return switchInSlots(sideState).map(slot => ({
    choice: `switch ${slot}`, label: `→ ${sideState.pokemon[slot - 1].species.name}`, once: false, bench: slot,
  }));
}

// A locked entry stays whatever its moveSlot says: Disable flags the slot of a locked Outrage, and the simulator plays
// the locked move before it reads the flag (side.js chooseMove), so dropping it would leave the slot with no choice.
function isBarred(move: RequestMove, liveDisabled: ReadonlySet<string>): boolean {
  if ('disabled' in move && move.disabled) return true;
  return !isLockedEntry(move) && liveDisabled.has(requestMoveKey(move));
}

function slotGimmicks(entry: ActiveRequestSlot, allowTera: boolean): { canTera: boolean; canMega: boolean; canUltra: boolean } {
  return {
    canTera: allowTera && !!entry.canTerastallize,
    canMega: !!entry.canMegaEvo,
    canUltra: !!entry.canUltraBurst,
  };
}

function partnerTarget(sideState: Side, move: RequestMove, slot: number, played: PlayedSlots[number] | undefined): { suffix: string; label: string } | null {
  const loc = played?.kind === 'move' && toId(played.name) === requestMoveKey(move) ? played.targetLoc : null;
  const user = sideState.active[slot];
  const partner = loc !== null && loc !== undefined && loc < 0 ? sideState.active[-loc - 1] : null;
  if (!user || !partner || partner === user || !sideState.battle.validTargetLoc(loc!, user, move.target as string)) return null;
  return { suffix: ` ${loc}`, label: `${move.move}→${partner.species.name}` };
}

function moveTargets(sideState: Side, move: RequestMove, slot: number, played?: PlayedSlots[number]): { suffix: string; label: string }[] {
  // A locked entry (rampage, charge, recharge, Bide, Uproar) names no target type: the sim keeps it (side.js:480-492)
  // so the slot offers one bare option and applyChoice submits it by index (`move outrage` is rejected).
  if (isLockedEntry(move)) return [{ suffix: '', label: move.move }];
  const foeActives = sideState.foe.active;
  const targetType = move.target as string | undefined;
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
  const partner = partnerTarget(sideState, move, slot, played);
  if (partner && !targets.some(target => target.suffix === partner.suffix)) targets.push(partner);
  return targets;
}

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

function slotChoicesFor(
  sideState: Side,
  entry: ActiveRequestSlot | null | undefined,
  forced: boolean,
  slot: number,
  allowTera: boolean,
  played?: PlayedSlots[number],
): SlotChoice[] {
  if (forced) return benchSwitches(sideState);
  const pokemon = sideState.active[slot];
  // The sim passes a fainted, an empty and a commanding slot (Commander): its choice goes to the next slot.
  if (!entry || !pokemon || nextChoosingSlot(sideState, slot) !== slot) return [];

  // Requests conceal 'hidden' trapping (an unrevealed Magnet Pull), yet validation rejects: read the live field.
  const trapped = ('trapped' in entry && !!entry.trapped) || !!pokemon.trapped;
  const gimmicks = slotGimmicks(entry, allowTera);
  const choices: SlotChoice[] = [];
  // Requests conceal 'hidden' disables (Imprison): a concealed-disabled candidate is a reject that kills the search.
  const liveDisabled = new Set<string>(pokemon.moveSlots.filter(slot => slot.disabled).map(slot => slot.id));

  for (const move of entry.moves) {
    if (isBarred(move, liveDisabled)) continue;
    const key = requestMoveKey(move);
    for (const target of moveTargets(sideState, move, slot, played)) {
      pushSlotChoices(choices, key, target, gimmicks);
    }
  }

  if (!trapped) choices.push(...benchSwitches(sideState));
  return choices;
}

function teraAllowed(tera: TeraAllowance | undefined, side: 'p1' | 'p2', pokemon: Pokemon | null): boolean {
  if (tera === undefined || tera === true) return true;
  if (tera === false || !pokemon) return false;
  const list = tera[side];
  return list.includes(pokemon.species.name) || list.includes(pokemon.species.baseSpecies);
}

type ActiveRequest = NonNullable<Side['activeRequest']>;

// Team preview: doubles offers every unordered lead pair, singles every lead; the sim autocompletes the back order.
// Digit lists stay unambiguous because teams never exceed 6.
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

function combineSlots(perSlot: SlotChoice[][]): ChoiceOption[] {
  const combined: ChoiceOption[] = [];
  for (const first of perSlot[0]) {
    for (const second of perSlot[1]) {
      if (first.once && second.once) continue; // one Tera/Mega/Ultra per side per turn
      if (first.bench !== null && first.bench === second.bench) continue;
      combined.push({ choice: `${first.choice}, ${second.choice}`, label: `${first.label} + ${second.label}` });
    }
  }
  return combined;
}

function assignmentLabel(sideState: Side, choice: string): string {
  return choice.split(',').map(part => {
    const tokens = part.trim().split(' ');
    if (tokens[0] !== 'switch') return 'pass';
    return `→ ${sideState.pokemon[parseInt(tokens[1], 10) - 1].species.name}`;
  }).join(' + ');
}

interface ChoiceList {
  options: ChoiceOption[];
  slots: number[];
}

// Slots the sim auto-passes (fainted or empty) are skipped: an explicit `pass` trips "more choices than unfainted"
function doublesList(
  sideState: Side,
  actives: (ActiveRequestSlot | null | undefined)[],
  forceSwitch: boolean[],
  slotCount: number,
  side: 'p1' | 'p2',
  tera: TeraAllowance | undefined,
  partner?: PlayedSlots,
): ChoiceList {
  // More forced slots than living replacements: the per-slot product drops each shared-target pair and leaves nothing;
  // leaves nothing; the sim wants a pass for each slot no body can fill.
  const forcedCount = forceSwitch.filter(Boolean).length;
  const bench = benchSwitches(sideState).map(entry => entry.bench!);
  if (forcedCount > 1 && bench.length < forcedCount) {
    const options = switchAssignments(forcedCount, bench).map(choice => ({ choice, label: assignmentLabel(sideState, choice) }));
    return { options, slots: forceSwitch.flatMap((forced, slot) => (forced && slot < slotCount ? [slot] : [])) };
  }
  const perSlot: SlotChoice[][] = [];
  const slots: number[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const slotTera = teraAllowed(tera, side, sideState.active[slot] ?? null);
    const slotChoices = slotChoicesFor(sideState, actives[slot], !!forceSwitch[slot], slot, slotTera, partner?.[slot]);
    if (slotChoices.length > 0) {
      perSlot.push(slotChoices);
      slots.push(slot);
    }
  }
  if (perSlot.length === 0) return { options: [], slots };
  if (perSlot.length === 1) return { options: perSlot[0].map(({ choice, label }) => ({ choice, label })), slots };
  return { options: combineSlots(perSlot), slots };
}

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

function singlesMoveChoices(
  sideState: Side,
  active: ActiveRequestSlot,
  side: 'p1' | 'p2',
  tera: TeraAllowance | undefined,
  options: ChoiceOption[],
): void {
  const activeTera = teraAllowed(tera, side, sideState.active[0] ?? null);
  const liveDisabled = new Set<string>(
    (sideState.active[0]?.moveSlots ?? []).filter(slot => slot.disabled).map(slot => slot.id));
  for (const move of active.moves) {
    if (isBarred(move, liveDisabled)) continue;
    // Same id-over-display-name rule as slotChoicesFor ("Return 102" -> return).
    const key = requestMoveKey(move);
    options.push({ choice: `move ${key}`, label: move.move });
    pushSinglesGimmicks(options, key, move, active, activeTera);
  }
}

function singlesChoices(
  request: ActiveRequest,
  sideState: Side,
  side: 'p1' | 'p2',
  tera: TeraAllowance | undefined,
): ChoiceOption[] {
  const options: ChoiceOption[] = [];
  const active = 'active' in request ? request.active?.[0] : undefined;
  const forced = 'forceSwitch' in request && !!request.forceSwitch?.[0];
  const trapped = !!active && (('trapped' in active && !!active.trapped) || !!sideState.active[0]?.trapped);

  if (active && !forced) singlesMoveChoices(sideState, active, side, tera, options);

  if (forced || !trapped) {
    for (const { choice, label } of benchSwitches(sideState)) options.push({ choice, label });
  }

  return options;
}

/** `legalChoices` with the slot behind each part of a choice string. */
export function choiceList(
  position: SimPosition,
  side: 'p1' | 'p2',
  opts?: { tera?: TeraAllowance; partner?: PlayedSlots },
): ChoiceList {
  const battle = positionBattle(position);
  const sideState = battle.sides[sideIndex(side)];
  const request = sideState.activeRequest;
  if (!request || battle.ended) return { options: [], slots: [] };
  // Mid forced switch: the other side replaces and this side cannot act; invented switches are rejected.
  // The sentinel never reaches the sim (applyChoice skips it).
  if ('wait' in request && request.wait) {
    return { options: [{ choice: 'wait', label: '(waiting)' }], slots: [] };
  }
  if ('teamPreview' in request && request.teamPreview) return { options: teamPreviewChoices(battle, sideState), slots: [] };

  const actives = 'active' in request ? request.active ?? [] : [];
  const forceSwitch = 'forceSwitch' in request ? request.forceSwitch ?? [] : [];
  const slotCount = Math.max(actives.length, forceSwitch.length);
  if (slotCount > 1) return doublesList(sideState, actives, forceSwitch, slotCount, side, opts?.tera, opts?.partner);
  return { options: singlesChoices(request, sideState, side, opts?.tera), slots: [0] };
}

export function legalChoices(
  position: SimPosition,
  side: 'p1' | 'p2',
  opts?: { tera?: TeraAllowance; partner?: PlayedSlots },
): ChoiceOption[] {
  return choiceList(position, side, opts).options;
}
