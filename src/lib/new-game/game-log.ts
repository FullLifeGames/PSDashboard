// Pure function of the record: `|t:|` clock lines are dropped, so the same record gives the same bytes on every reload.

import { simFormats } from '@fulllifegames/replay-core';

const isClock = (line: string): boolean => line.startsWith('|t:|');
const isDebug = (line: string): boolean => line.startsWith('|debug|');

/** Whether the format prints debug lines (the `debug` flag, Custom Game only); the game's log leaves them out. */
export const formatPrintsDebug = (formatId: string): boolean => !!simFormats().get(formatId).debug;

export function bodyLines(runtimeLog: readonly string[]): string[] {
  const start = runtimeLog.findIndex(line => line.startsWith('|start'));
  return (start < 0 ? [] : runtimeLog.slice(start)).filter(line => !isClock(line));
}

/** Lines after `known` lines of the runtime's log, which counts clock lines too; clock lines out. */
export function newLines(runtimeLog: readonly string[], known: number): string[] {
  return runtimeLog.slice(known).filter(line => !isClock(line));
}

export function assembleGameLog(header: readonly string[], body: readonly string[], formatId?: string): string {
  const printsDebug = formatId !== undefined && formatPrintsDebug(formatId);
  return [...header, ...body].filter(line => !isClock(line) && (printsDebug || !isDebug(line))).join('\n');
}
