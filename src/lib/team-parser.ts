/**
 * Parses PS team export format, handling German stat abbreviations.
 * German: KP=HP, Ang=Atk, Vert=Def, SpA=SpA, SpV=SpD, Init=Spe
 */

const GERMAN_STAT_MAP: Record<string, string> = {
  'KP': 'HP',
  'Ang': 'Atk',
  'Vert': 'Def',
  'SpV': 'SpD',
  'Init': 'Spe',
  // SpA is the same in both languages
};

export function preprocessGermanTeam(rawText: string): string {
  return rawText.replace(
    /\b(KP|Ang|Vert|SpV|Init)\b/g,
    (match) => GERMAN_STAT_MAP[match] || match
  );
}

export function parseTeamText(rawText: string): string {
  return preprocessGermanTeam(rawText);
}
