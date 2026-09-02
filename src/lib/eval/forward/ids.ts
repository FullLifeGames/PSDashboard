/** Choice-string ids and side indices shared by the forward-model stages. */

export const choiceKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function sideIndex(side: 'p1' | 'p2'): 0 | 1 {
  return side === 'p1' ? 0 : 1;
}
