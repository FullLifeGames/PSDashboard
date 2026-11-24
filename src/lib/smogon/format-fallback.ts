/** A VGC format's year-level data name (`gen9vgc2026`, `gen9championsvgc2026`); null for every other format. */
export function vgcYearFormat(id: string): string | null {
  const match = id.match(/(champions)?vgc(\d{4})/);
  return match ? `${id.match(/^gen\d+/)?.[0] ?? 'gen9'}${match[1] ?? ''}vgc${match[2]}` : null;
}

/** @pkmn/smogon names Champions sets files without the generation (sets/championsou.json); null for other formats. */
export function championsSetsFormat(id: string): string | null {
  return id.match(/^gen\d+(champions[a-z0-9]+)$/)?.[1] ?? null;
}

/** Where a format's data lives when it has none: doubles ladders read Doubles OU, draft and Custom Game the OU. */
export function ouFallbackFormat(id: string): string {
  // Gen 4 Doubles OU has a stats file of its own; a Gen 3 one falls through to the generation's OU.
  if (id.includes('doubles') || id.includes('vgc')) return `${id.match(/^gen\d+/)?.[0] ?? 'gen9'}doublesou`;
  if (/^gen\d+draft/.test(id)) return id.replace(/draft.*$/, 'ou');
  const customGame = id.match(/^(gen\d+)customgame$/);
  if (customGame) return `${customGame[1]}ou`;
  return id || 'gen9ou';
}

export function nationalDexDoublesFormat(id: string): string | null {
  return id.includes('nationaldexdoubles') ? `${id.match(/^gen\d+/)?.[0] ?? 'gen9'}nationaldexdoubles` : null;
}
