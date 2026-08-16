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

/** Sentences fire only at streak milestones — a 4th repeat is not news. */
const isMilestone = (n: number) => n >= 3 && (n === 3 || n === 5 || n % 5 === 0);

const SECONDARY_EVENTS: Record<string, StreakOdds['event']> = {
  frz: 'freeze', par: 'paralysis', brn: 'burn', flinch: 'flinch',
};

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
  let sameMoveRun = 0;
  for (let index = entries.length - 1; index >= 0; index--) {
    const at = entries[index];
    if (!at || !at.moveId || at.attacker !== last.attacker || at.moveId !== last.moveId || at.defender !== last.defender) break;
    sameMoveRun += 1;
  }
  const move = dex.moves.get(last.moveId);
  if (move.exists && isMilestone(sameMoveRun)) {
    const secondaries = move.secondaries ?? (move.secondary ? [move.secondary] : []);
    const fished = secondaries.find(secondary => {
      if (!secondary?.chance) return false;
      const status = secondary.status ?? secondary.volatileStatus;
      return status !== undefined && status in SECONDARY_EVENTS;
    });
    const suppressed = last.defenderAbility === 'shielddust' || last.defenderItem === 'covertcloak';
    if (fished && !suppressed) {
      const event = SECONDARY_EVENTS[(fished.status ?? fished.volatileStatus)!];
      const run = entries.slice(entries.length - sameMoveRun) as StreakHistoryEntry[];
      const flinchable = event !== 'flinch' || run.every(at => at.movedFirst);
      let perTurn = (fished.chance! / 100) * (last.attackerAbility === 'serenegrace' ? 2 : 1);
      perTurn = Math.min(1, perTurn);
      if (flinchable && perTurn > 0) {
        return {
          moveLabel: move.name,
          defenderSpecies: last.defender,
          n: sameMoveRun,
          perTurn,
          cumulative: 1 - (1 - perTurn) ** sameMoveRun,
          event,
        };
      }
      return null;
    }
  }

  // Crit detector: repeated attacks (any damaging moves) into a defender
  // whose relevant defensive boost is up on every streak turn — the crit is
  // exactly the roll those boosts cannot answer.
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
