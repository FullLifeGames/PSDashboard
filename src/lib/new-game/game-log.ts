// The log of a new game is a pure function of the record: `|t:|` clock lines are dropped, so the same record gives the same bytes on every reload.

import { simFormats } from '@fulllifegames/replay-core';

const isClock = (line: string): boolean => line.startsWith('|t:|');
const isDebug = (line: string): boolean => line.startsWith('|debug|');

/**
 * Whether the chosen format prints debug lines: Showdown does it only in a Custom Game (the format's `debug` flag). The Champions
 * formats play on a Custom Game stand-in whose flag writes the lines into the runtime's log; the game's log leaves them out.
 */
export const formatPrintsDebug = (formatId: string): boolean => !!simFormats().get(formatId).debug;

/** The lines of a runtime's log that belong to the game body: everything from the first `|start`, clock lines out. */
export function bodyLines(runtimeLog: readonly string[]): string[] {
  const start = runtimeLog.findIndex(line => line.startsWith('|start'));
  return (start < 0 ? [] : runtimeLog.slice(start)).filter(line => !isClock(line));
}

/** The lines a runtime wrote after `known` lines of its log (clock lines counted as the runtime counts them), clock lines out. */
export function newLines(runtimeLog: readonly string[], known: number): string[] {
  return runtimeLog.slice(known).filter(line => !isClock(line));
}

/** The replay log text of a game: header and body, no clock lines, and no debug lines unless the chosen format (`formatId`) prints them. */
export function assembleGameLog(header: readonly string[], body: readonly string[], formatId?: string): string {
  const printsDebug = formatId !== undefined && formatPrintsDebug(formatId);
  return [...header, ...body].filter(line => !isClock(line) && (printsDebug || !isDebug(line))).join('\n');
}
