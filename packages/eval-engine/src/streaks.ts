import { rulesDex, type RulesDex, type RulesMod } from '@fulllifegames/replay-core';

// Narrative only, never a grade: shown at milestones at render time.

export interface StreakHistoryEntry {
  attacker: string;
  /** Normalized move id; null = switch/no single move (breaks streaks). */
  moveId: string | null;
  defender: string;
  movedFirst: boolean;
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

type GenDex = RulesDex;
type DexMove = ReturnType<GenDex['moves']['get']>;

const isMilestone = (n: number) => n >= 3 && (n === 3 || n === 5 || n % 5 === 0);

const SECONDARY_EVENTS: Record<string, StreakOdds['event']> = {
  frz: 'freeze', par: 'paralysis', brn: 'burn', flinch: 'flinch',
};

function sameMoveRun(entries: (StreakHistoryEntry | null)[], last: StreakHistoryEntry): number {
  let run = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const at = entries[index];
    if (!at || !at.moveId || at.attacker !== last.attacker || at.moveId !== last.moveId || at.defender !== last.defender) break;
    run += 1;
  }
  return run;
}

// null when a secondary story comes to nothing (a flinch chain that lost the race); undefined with none.
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

/** A narratable streak in a side's played-move history (oldest first, null entries break streaks); null below gen 3. */
export function detectStreakOdds(gen: number, entries: (StreakHistoryEntry | null)[], mod?: RulesMod): StreakOdds | null {
  if (gen <= 2) return null;
  const last = entries[entries.length - 1];
  if (!last || !last.moveId) return null;
  const dex = rulesDex(gen, mod);

  const run = sameMoveRun(entries, last);
  const move = dex.moves.get(last.moveId);
  const secondary = secondaryStreak(move, last, entries, run);
  if (secondary !== undefined) return secondary;

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
