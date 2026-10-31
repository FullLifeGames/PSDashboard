import { useEffect, useState } from 'react';
import { branchSideChoicesReady, requiredChoicesForActiveSlots, type BranchSlotChoice, type DieWords, type LiveHit } from '@fulllifegames/eval-engine';
import type { BranchSimState } from './useBranch';
import { askDice, type DiceOffers } from '../lib/branch-dice-offers';
import { wordsOf } from '../lib/branch-dice';

/**
 * Round 82 (forced dice), step A7a: the dice the engine offers for the position the panel shows. The engine's offers read the live
 * battle on copies, so they exist only where the panel has the branch's battle (the live tip) and only in Advanced, where the chips
 * show. The answer lands after the lazy chunk loads, like the damage preview; `null` means the panel is still asking.
 */

type Battle = LiveHit['battle'];

/** A pick without its dice: the dice change what a turn plays, never what the move offers. */
const pickKey = (choice: BranchSlotChoice | null): string =>
  choice === null ? '-' : choice.kind === 'move' ? `m:${choice.moveId}:${choice.targetLoc ?? ''}:${choice.modifier ?? ''}` : `s:${choice.speciesId}`;

/** Which position and which picks an answer belongs to. */
function askKey(simState: BranchSimState): string {
  return JSON.stringify([simState.log.length, simState.p1Choices.map(pickKey), simState.p2Choices.map(pickKey)]);
}

/** The offers with the reader of names the chips use. */
export interface DiceView extends DiceOffers { words: DieWords }

export function useDiceOffers(args: { enabled: boolean; simState: BranchSimState | null; getBattle: (() => Battle | null) | undefined }): DiceView | null {
  const { enabled, simState, getBattle } = args;
  const [answer, setAnswer] = useState<{ key: string; view: DiceView } | null>(null);
  const key = enabled && simState && getBattle ? askKey(simState) : null;
  useEffect(() => {
    if (key === null || !simState || !getBattle) return;
    const forKey = key;
    let cancelled = false;
    async function ask() {
      const engine = await import('../lib/lazy/branch-engine');
      const battle = getBattle?.() ?? null;
      if (cancelled || !battle || !simState) return;
      const p1Slots = simState.p1ActiveSlots ?? [];
      const p2Slots = simState.p2ActiveSlots ?? [];
      const required = {
        p1: requiredChoicesForActiveSlots(p1Slots, simState.p1ForceSwitches),
        p2: requiredChoicesForActiveSlots(p2Slots, simState.p2ForceSwitches),
      };
      const choices = { p1: simState.p1Choices, p2: simState.p2Choices };
      const turnReady = !simState.ended && !simState.p1ForceSwitch && !simState.p2ForceSwitch
        && branchSideChoicesReady(choices.p1, required.p1) && branchSideChoicesReady(choices.p2, required.p2);
      setAnswer({ key: forKey, view: { ...askDice(engine, { battle, choices, required, turnReady }), words: wordsOf(battle) } });
    }
    void ask();
    return () => {
      cancelled = true;
    };
  }, [key, simState, getBattle]);
  return key !== null && answer?.key === key ? answer.view : null;
}
