// A copy of packages/replay-core/src/line-endings.ts (not in its barrel, this package reads barrels only).
export function normalizeLineEndings(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

/** Cuts one trailing '\r' from each line (same array when none has one): readers that match to the line end miss it. */
export function normalizeLines(lines: string[]): string[];
export function normalizeLines(lines: readonly string[]): readonly string[];
export function normalizeLines(lines: readonly string[]): readonly string[] {
  return lines.some(line => line.endsWith('\r')) ? lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line)) : lines;
}
