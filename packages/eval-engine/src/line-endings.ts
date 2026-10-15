/**
 * Round 70 (T206 for the engine): the protocol writes one line per '\n', and a log that crossed a Windows editor, a download or a
 * video pipeline arrives with '\r\n'. Every exported function that takes a replay log reads it through this once at its door; the
 * readers behind the door see LF only and keep no '\r' handling of their own. An LF text comes back as the same string.
 *
 * This is a copy of packages/replay-core/src/line-endings.ts: that helper is no part of replay-core's barrel (the package API is
 * pinned by regression/fixtures/api/), and this package reaches replay-core by its barrel only.
 */
export function normalizeLineEndings(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/**
 * The door of the exported readers that take a turn's lines instead of the log (parsePlayedActions, parsePlayedActionsDoubles,
 * detectSacks, detectRolls, diceEventTurns). A caller that cut a CRLF log at '\n' hands them lines that still end in '\r', and a
 * reader that matches to the line end answers wrongly without a word (detectSacks found no faint, detectRolls flipped a KO flag).
 * The lines from `allTurnEvents` and the snapshots come from a normalized log and pass through untouched. Lines without a '\r'
 * come back as the same array; otherwise a copy has the one trailing '\r' cut from each line. A '\r' inside a line is no line
 * ending and stays.
 */
export function normalizeLines(lines: string[]): string[];
export function normalizeLines(lines: readonly string[]): readonly string[];
export function normalizeLines(lines: readonly string[]): readonly string[] {
  return lines.some(line => line.endsWith('\r')) ? lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line)) : lines;
}
