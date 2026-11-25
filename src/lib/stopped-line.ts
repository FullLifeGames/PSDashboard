// The shapes are those of `StoppedRun` and `EvalStatus` in the evaluation hook, which library code does not import.
export function stoppedEmptyHere(
  stopped: { tag: string | null; empty?: true } | null, shown: { live: boolean; status: string; key: string },
): boolean {
  return stopped?.empty === true && shown.live && shown.status === 'idle' && stopped.tag === shown.key;
}
