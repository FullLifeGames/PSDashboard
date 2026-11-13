import { simFormats, toId } from '@fulllifegames/replay-core';
import { formatGroups, loadFormatGroups, type FormatGroup, type FormatOption } from './format-options';

/**
 * Round 89 (lane H, #105), stage H4: the list the New game dialog shows (user ruling 13.11.2026, H3a and H9a). The simulator's whole
 * list of playable formats, searchable, grouped by generation; the five measured families on top under "Calibrated", the
 * Custom Games of Generation 9 (the Champions ones too) under "Custom Game". The ids of the measured families are this
 * list's configuration: the bank and the holdouts measure these five.
 */

export const CALIBRATED_FORMATS = ['gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9championsou', 'gen9championsvgc2026regmc'] as const;
export const CALIBRATED_LABEL = 'Calibrated';
export const CUSTOM_LABEL = 'Custom Game';

/** The registry's groups as the dialog shows them: Calibrated, Custom Game, then the generations. Reads the registry as it stands. */
export function panelGroups(): FormatGroup[] {
  const groups = formatGroups(CALIBRATED_FORMATS).map(group => (group.label === 'Featured' ? { ...group, label: CALIBRATED_LABEL } : group));
  const isCustom = (option: FormatOption) => option.custom && option.generation === 9;
  // Generation 9 before Champions, singles before doubles
  const customs = groups.flatMap(group => group.options).filter(option => isCustom(option) && !CALIBRATED_FORMATS.includes(option.id as never))
    .sort((a, b) => Number(a.champions) - Number(b.champions) || Number(a.gameType === 'doubles') - Number(b.gameType === 'doubles'));
  if (customs.length === 0) return groups;
  const rest = groups.map(group => ({ ...group, options: group.options.filter(option => !customs.includes(option)) })).filter(group => group.options.length > 0);
  const at = rest.findIndex(group => group.label !== CALIBRATED_LABEL);
  rest.splice(at < 0 ? rest.length : at, 0, { label: CUSTOM_LABEL, options: customs });
  return rest;
}

/** `panelGroups` after the Champions mod loads (the registry gains its Champions formats). */
export async function loadPanelGroups(): Promise<FormatGroup[]> {
  await loadFormatGroups(CALIBRATED_FORMATS);
  return panelGroups();
}

/** The groups that hold a format whose name or id contains the query (letters and digits only, any case); an empty query keeps all. */
export function searchGroups(groups: readonly FormatGroup[], query: string): FormatGroup[] {
  const needle = toId(query);
  if (!needle) return [...groups];
  return groups
    .map(group => ({ ...group, options: group.options.filter(option => toId(option.name).includes(needle) || option.id.includes(needle)) }))
    .filter(group => group.options.length > 0);
}

/** One line about a format, from the simulator's own rule table: its game type, the bring count at Team Preview, a Custom Game's freedom. */
export function formatNote(option: FormatOption): string {
  const parts: string[] = [option.gameType];
  const format = simFormats().get(option.id);
  try {
    const rules = simFormats().getRuleTable(format);
    const picked = rules.pickedTeamSize;
    if (rules.has('teampreview') && typeof picked === 'number' && picked > 0) parts.push(`bring ${picked}`);
  } catch {
    // a rule table the registry refuses: the game type alone
  }
  if (option.custom) parts.push('any set');
  return parts.join(' · ');
}
