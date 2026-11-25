const GERMAN_STAT_MAP: Record<string, string> = {
  'KP': 'HP',
  'Ang': 'Atk',
  'Vert': 'Def',
  'SpV': 'SpD',
  'Init': 'Spe',
};

function preprocessGermanTeam(rawText: string): string {
  return rawText.replace(
    /\b(KP|Ang|Vert|SpV|Init)\b/g,
    (match) => GERMAN_STAT_MAP[match] || match
  );
}

/** Rewrites the German stat labels of a pasted team export (KP, Ang, Vert, SpV, Init) to the English ones. */
export function parseTeamText(rawText: string): string {
  return preprocessGermanTeam(rawText);
}
