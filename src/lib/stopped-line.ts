/**
 * The panel says "Search stopped before a first result." only while the position it shows is the one the user stopped: the stop marked
 * no result (`empty`), the panel shows the live position, nothing runs, and the mark's tag is the position's own. The shapes are those
 * of `StoppedRun` and `EvalStatus` in the evaluation hook, which library code does not import.
 */
export function stoppedEmptyHere(
  stopped: { tag: string | null; empty?: true } | null, shown: { live: boolean; status: string; key: string },
): boolean {
  return stopped?.empty === true && shown.live && shown.status === 'idle' && stopped.tag === shown.key;
}
