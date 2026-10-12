/** Pokémon Champions formats count Stat Points and play every IV at 31 (the one place that names the family). */
export const isChampionsFormat = (formatid: string): boolean => /champions/.test(formatid);
