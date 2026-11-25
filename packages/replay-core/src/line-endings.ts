/** A log with LF line endings: every exported function that takes a log reads it through this (no '\r' handling). */
export function normalizeLineEndings(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}
