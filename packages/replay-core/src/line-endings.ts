/**
 * Round 70 (T206): the protocol writes one line per '\n', and a log that crossed a Windows editor, a download or a video
 * pipeline arrives with '\r\n' (the app's loader normalizes the same way, src/lib/replay-file.ts). Every exported function
 * that takes a log reads it through this once at its door; the readers behind the door see LF only and keep no '\r' handling
 * of their own. An LF text comes back as the same string.
 */
export function normalizeLineEndings(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}
