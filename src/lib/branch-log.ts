import { withDieLines, type DieLine } from './branch-dice-lines';


const HIDDEN_FROM_FRAME = ['|split|', '|c|', '|debug|'];

/** The log the frame plays: the sim's lines as they are (the embed matches Pokémon by ident), `dieLines` inserted. */
export function branchFrameLog(simLog: readonly string[], dieLines: readonly DieLine[] = []): string {
  return withDieLines(simLog, dieLines)
    .filter(line => line && !HIDDEN_FROM_FRAME.some(prefix => line.startsWith(prefix)))
    .join('\n');
}
