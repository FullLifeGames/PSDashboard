/**
 * Small indexed-job pipeline: `size` jobs run through at most `laneCount`
 * concurrent lanes, picked up in index order. A job resolving false stops
 * every lane from picking up further work (in-flight jobs still settle),
 * and the call resolves false — the sweep's "cancelled" signal. Pure
 * scheduling: results must not depend on which lane runs a job or in what
 * order jobs finish.
 */
export async function runInLanes(
  laneCount: number,
  size: number,
  run: (index: number) => Promise<boolean>,
): Promise<boolean> {
  let next = 0;
  let ok = true;
  const lane = async () => {
    while (ok) {
      const index = next++;
      if (index >= size) return;
      if (!(await run(index))) ok = false;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(laneCount, size)) }, lane));
  return ok;
}
