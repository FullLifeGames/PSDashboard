/**
 * Where a format's published data lives when the format itself has none:
 * doubles and VGC ladders read Doubles OU, draft formats and Custom Game
 * read their generation's OU, everything else is itself.
 */
export function ouFallbackFormat(id: string): string {
  if (id.includes('doubles') || id.includes('vgc')) return 'gen9doublesou';
  if (/^gen\d+draft/.test(id)) return id.replace(/draft.*$/, 'ou');
  const customGame = id.match(/^(gen\d+)customgame$/);
  if (customGame) return `${customGame[1]}ou`;
  return id || 'gen9ou';
}
