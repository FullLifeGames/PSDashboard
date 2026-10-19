/**
 * The protocol log the replay iframe plays for a branch: the simulator's lines
 * without what the embed must not show.
 *
 * The embed finds a Pokémon again by its ident and its details string
 * (`|switch|p1a: NOT ICT|Landorus-Therian, M, shiny|`). Since round 72 (T238)
 * the team builder gives every set the replay's own nickname, level, gender and
 * shiny flag, so the simulator writes those lines as the game did and the frame
 * plays them as they are. Before, the frame rewrote every ident and every
 * details string of the simulator's lines into the replay's names: a simulator
 * switch-in met no roster entry and became a second one, and the sidebar kept
 * showing the first one alive.
 */

/** Lines the embed must not show: spectator splits, chat, and the simulator's debug output (G13). */
const HIDDEN_FROM_FRAME = ['|split|', '|c|', '|debug|'];

/** The log string the iframe plays: the branch's lines without what the embed must not show. */
export function branchFrameLog(simLog: readonly string[]): string {
  return simLog
    .filter(line => line && !HIDDEN_FROM_FRAME.some(prefix => line.startsWith(prefix)))
    .join('\n');
}
