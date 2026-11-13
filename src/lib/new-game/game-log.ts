/**
 * Round 89 (lane H, #105): the log of a new game. The record is the truth and the log is its replay: the header comes from
 * the format's own battle up to the start (`startGameLog`), the body is the lines the simulator wrote from `|start|` on, one
 * run of lines per finished turn. The `|t:|` clock lines are dropped, so the log is a pure function of the record: the same
 * record gives the same bytes on every machine and every reload.
 */

import { simFormats } from '@fulllifegames/replay-core';

const isClock = (line: string): boolean => line.startsWith('|t:|');
const isDebug = (line: string): boolean => line.startsWith('|debug|');

/**
 * Whether the chosen format prints debug lines: Showdown does it only in a Custom Game (the format's `debug` flag). The Champions
 * formats play on a Custom Game stand-in whose flag writes the lines into the runtime's log; the game's log leaves them out, so the
 * frame shows what Showdown shows (round 89, H7).
 */
export const formatPrintsDebug = (formatId: string): boolean => !!simFormats().get(formatId).debug;

/** The lines of a runtime's log that belong to the game body: everything from the first `|start`, clock lines out. */
export function bodyLines(runtimeLog: readonly string[]): string[] {
  const start = runtimeLog.findIndex(line => line.startsWith('|start'));
  return (start < 0 ? [] : runtimeLog.slice(start)).filter(line => !isClock(line));
}

/**
 * The lines a runtime wrote after `known` lines of its log (the lines the record already holds, clock lines counted as the
 * runtime counts them), clock lines out: one finished turn's contribution to the body.
 */
export function newLines(runtimeLog: readonly string[], known: number): string[] {
  return runtimeLog.slice(known).filter(line => !isClock(line));
}

/**
 * The replay log text of a game: its header and body, one line each, no clock lines, and no debug lines unless the chosen format
 * (`formatId`) prints them. The record's body keeps what the runtime wrote; the log is what the frame and the readers see.
 */
export function assembleGameLog(header: readonly string[], body: readonly string[], formatId?: string): string {
  const printsDebug = formatId !== undefined && formatPrintsDebug(formatId);
  return [...header, ...body].filter(line => !isClock(line) && (printsDebug || !isDebug(line))).join('\n');
}
