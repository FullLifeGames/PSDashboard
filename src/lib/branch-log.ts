import { withDieLines, type DieLine } from './branch-dice-lines';

/** The protocol log the replay iframe plays for a branch: the simulator's lines without what the embed must not show. */

/** Lines the embed must not show: spectator splits, chat and the simulator's debug output. */
const HIDDEN_FROM_FRAME = ['|split|', '|c|', '|debug|'];

/**
 * The embed finds a Pokémon again by its ident and its details string (`|switch|p1a: NOT ICT|Landorus-Therian, M, shiny|`): the sim's
 * lines play as they are because the team builder gives every set the replay's nickname, level, gender and shiny flag (a rewritten
 * ident made a switch-in a second roster entry and the sidebar kept the first alive). `dieLines` go in at the indexes of the shown log.
 */
export function branchFrameLog(simLog: readonly string[], dieLines: readonly DieLine[] = []): string {
  return withDieLines(simLog, dieLines)
    .filter(line => line && !HIDDEN_FROM_FRAME.some(prefix => line.startsWith(prefix)))
    .join('\n');
}
