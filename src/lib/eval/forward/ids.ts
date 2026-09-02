/** Side indices shared by the forward-model stages. */

export function sideIndex(side: 'p1' | 'p2'): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}
