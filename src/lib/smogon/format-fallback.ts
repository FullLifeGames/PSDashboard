/**
 * A VGC format's year-level data name (round 66): Scarlet/Violet VGC
 * `gen9vgc2026`, Pokémon Champions VGC `gen9championsvgc2026`; null for
 * every other format. The stats files carry it as is
 * (stats/gen9championsvgc2026.json); for sets, @pkmn/smogon names Champions
 * files without the generation (sets/championsvgc2026.json).
 */
export function vgcYearFormat(id: string): string | null {
  const match = id.match(/(champions)?vgc(\d{4})/);
  return match ? `${id.match(/^gen\d+/)?.[0] ?? 'gen9'}${match[1] ?? ''}vgc${match[2]}` : null;
}

/**
 * The sets file of a Pokémon Champions format without a VGC year (round 67,
 * T143): @pkmn/smogon names Champions sets files without the generation
 * (sets/championsou.json), and `gen9championsou` asked for a file that does
 * not exist and fell back to the Scarlet/Violet Ubers analyses. Null for
 * every other format; a Champions VGC format reads its year first
 * (vgcYearFormat).
 */
export function championsSetsFormat(id: string): string | null {
  return id.match(/^gen\d+(champions[a-z0-9]+)$/)?.[1] ?? null;
}

/**
 * Where a format's published data lives when the format itself has none:
 * doubles ladders read Doubles OU, draft formats and Custom Game read their
 * generation's OU, everything else is itself. A VGC format with a year reads
 * its year's files first (vgcYearFormat); only a VGC id without one lands
 * here on Doubles OU.
 */
export function ouFallbackFormat(id: string): string {
  if (id.includes('doubles') || id.includes('vgc')) return 'gen9doublesou';
  if (/^gen\d+draft/.test(id)) return id.replace(/draft.*$/, 'ou');
  const customGame = id.match(/^(gen\d+)customgame$/);
  if (customGame) return `${customGame[1]}ou`;
  return id || 'gen9ou';
}
