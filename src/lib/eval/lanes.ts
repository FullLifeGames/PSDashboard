/** Runs `size` jobs in index order through `laneCount` lanes; a job returning false stops pickups and the call. */
// Results must not depend on which lane runs a job or in what order jobs finish.
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
