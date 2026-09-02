import { Dex } from '@pkmn/dex';

/**
 * Multi-turn expectation cumulation (round 6 expectation grounding, the
 * NARRATIVE half of the ② channel split): what repetition buys — secondary
 * fishing (freeze/paralysis/burn/flinch chains) and crit accumulation
 * against boosted walls. Render-time only, milestone-throttled, never a
 * grade: the value channel prices the next roll; this names what many
 * rolls mean.
 */

export interface StreakHistoryEntry {
  /** Attacker species at that turn. */
  attacker: string;
  /** Normalized move id; null = switch/no single move (breaks streaks). */
  moveId: string | null;
  /** Opposing active species. */
  defender: string;
  movedFirst: boolean;
  /** Ability/item ids ('serenegrace'). */
  attackerAbility: string;
  defenderAbility: string;
  defenderItem: string;
  defenderBoosts: { def: number; spd: number };
}

export interface StreakOdds {
  moveLabel: string;
  defenderSpecies: string;
  n: number;
  perTurn: number;
  cumulative: number;
  event: 'freeze' | 'paralysis' | 'burn' | 'flinch' | 'crit';
}

type GenDex = ReturnType<typeof Dex.forGen>;
type DexMove = ReturnType<GenDex['moves']['get']>;

/** Sentences fire only at streak milestones — a 4th repeat is not news. */
const isMilestone = (n: number) => n >= 3 && (n === 3 || n === 5 || n % 5 === 0);

const SECONDARY_EVENTS: Record<string, StreakOdds['event']> = {
  frz: 'freeze', par: 'paralysis', brn: 'burn', flinch: 'flinch',
};

/** The same attacker repeating the same move into the same defender, counted back from the current turn. */
function sameMoveRun(entries: (StreakHistoryEntry | null)[], last: StreakHistoryEntry): number {
  let run = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const at = entries[index];
    if (!at || !at.moveId || at.attacker !== last.attacker || at.moveId !== last.moveId || at.defender !== last.defender) break;
    run += 1;
  }
  return run;
}

/**
 * Secondary fishing at a milestone: the odds when the streak fishes for a
 * narratable, unsuppressed secondary; null when that story exists but
 * nothing comes of it (a flinch chain that lost the speed race, a zero
 * rate); undefined when there is no secondary story to tell.
 */
function secondaryStreak(
  move: DexMove,
  last: StreakHistoryEntry,
  entries: (StreakHistoryEntry | null)[],
  run: number,
): StreakOdds | null | undefined {
  if (!(move.exists && isMilestone(run))) return undefined;
  const secondaries = move.secondaries ?? (move.secondary ? [move.secondary] : []);
  const fished = secondaries.find(secondary => {
    if (!secondary?.chance) return false;
    const status = secondary.status ?? secondary.volatileStatus;
    return status !== undefined && status in SECONDARY_EVENTS;
  });
  const suppressed = last.defenderAbility === 'shielddust' || last.defenderItem === 'covertcloak';
  if (!(fished && !suppressed)) return undefined;
  const event = SECONDARY_EVENTS[(fished.status ?? fished.volatileStatus)!];
  const streak = entries.slice(entries.length - run) as StreakHistoryEntry[];
  const flinchable = event !== 'flinch' || streak.every(at => at.movedFirst);
  let perTurn = (fished.chance! / 100) * (last.attackerAbility === 'serenegrace' ? 2 : 1);
  perTurn = Math.min(1, perTurn);
  if (flinchable && perTurn > 0) {
    return {
      moveLabel: move.name,
      defenderSpecies: last.defender,
      n: run,
      perTurn,
      cumulative: 1 - (1 - perTurn) ** run,
      event,
    };
  }
  return null;
}

/**
 * Repeated attacks (any damaging moves) into a defender whose relevant
 * defensive boost is up on every streak turn — the crit is exactly the
 * roll those boosts cannot answer. Counted back from the current turn.
 */
function boostedAttackRun(dex: GenDex, last: StreakHistoryEntry, entries: (StreakHistoryEntry | null)[]): number {
  let attackRun = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const at = entries[index];
    if (!at || !at.moveId || at.attacker !== last.attacker || at.defender !== last.defender) break;
    const atMove = dex.moves.get(at.moveId);
    if (!atMove.exists || atMove.category === 'Status') break;
    const boost = atMove.category === 'Physical' ? at.defenderBoosts.def : at.defenderBoosts.spd;
    if (boost <= 0) break;
    attackRun += 1;
  }
  return attackRun;
}

/**
 * Detect a narratable streak in a side's played-move history (entries
 * oldest→newest, the CURRENT turn last; null entries break streaks).
 * Secondary fishing is checked first; crit accumulation only speaks when
 * no secondary story exists. Returns null below gen 3 and off milestones.
 */
export function detectStreakOdds(gen: number, entries: (StreakHistoryEntry | null)[]): StreakOdds | null {
  if (gen <= 2) return null;
  const last = entries[entries.length - 1];
  if (!last || !last.moveId) return null;
  const dex = Dex.forGen(gen);

  // Secondary detector: the same attacker repeating the same move into the
  // same defender fishes for the move's secondary.
  const run = sameMoveRun(entries, last);
  const move = dex.moves.get(last.moveId);
  const secondary = secondaryStreak(move, last, entries, run);
  if (secondary !== undefined) return secondary;

  // Crit detector: repeated attacks (any damaging moves) into a defender
  // whose relevant defensive boost is up on every streak turn — the crit is
  // exactly the roll those boosts cannot answer.
  const attackRun = boostedAttackRun(dex, last, entries);
  if (!isMilestone(attackRun)) return null;
  const perTurn = gen >= 7 ? 1 / 24 : 1 / 16;
  return {
    moveLabel: move.exists ? move.name : last.moveId,
    defenderSpecies: last.defender,
    n: attackRun,
    perTurn,
    cumulative: 1 - (1 - perTurn) ** attackRun,
    event: 'crit',
  };
}
