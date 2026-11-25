import { simFormats, toId } from '@fulllifegames/replay-core';
import { formatGroups, loadFormatGroups, type FormatGroup, type FormatOption } from './format-options';


export const CALIBRATED_FORMATS = ['gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9championsou', 'gen9championsvgc2026regmc'] as const;
export const CALIBRATED_LABEL = 'Calibrated';
export const CUSTOM_LABEL = 'Custom Game';

export function panelGroups(): FormatGroup[] {
  const groups = formatGroups(CALIBRATED_FORMATS).map(group => (group.label === 'Featured' ? { ...group, label: CALIBRATED_LABEL } : group));
  const isCustom = (option: FormatOption) => option.custom && option.generation === 9;
  const customs = groups.flatMap(group => group.options).filter(option => isCustom(option) && !CALIBRATED_FORMATS.includes(option.id as never))
    .sort((a, b) => Number(a.champions) - Number(b.champions) || Number(a.gameType === 'doubles') - Number(b.gameType === 'doubles'));
  if (customs.length === 0) return groups;
  const rest = groups.map(group => ({ ...group, options: group.options.filter(option => !customs.includes(option)) })).filter(group => group.options.length > 0);
  const at = rest.findIndex(group => group.label !== CALIBRATED_LABEL);
  rest.splice(at < 0 ? rest.length : at, 0, { label: CUSTOM_LABEL, options: customs });
  return rest;
}

export async function loadPanelGroups(): Promise<FormatGroup[]> {
  await loadFormatGroups(CALIBRATED_FORMATS);
  return panelGroups();
}

export function searchGroups(groups: readonly FormatGroup[], query: string): FormatGroup[] {
  const needle = toId(query);
  if (!needle) return [...groups];
  return groups
    .map(group => ({ ...group, options: group.options.filter(option => toId(option.name).includes(needle) || option.id.includes(needle)) }))
    .filter(group => group.options.length > 0);
}

/** Whether the format has a Team Preview step; the rule table says so (Gen 1 to 4 formats have none). */
export function formatHasTeamPreview(formatId: string): boolean {
  try {
    return simFormats().getRuleTable(simFormats().get(formatId)).has('teampreview');
  } catch {
    return true;
  }
}

export function formatNote(option: FormatOption): string {
  const parts: string[] = [option.gameType];
  const format = simFormats().get(option.id);
  try {
    const rules = simFormats().getRuleTable(format);
    const picked = rules.pickedTeamSize;
    if (rules.has('teampreview') && typeof picked === 'number' && picked > 0) parts.push(`bring ${picked}`);
    if (!rules.has('teampreview')) parts.push('no Team Preview');
  } catch {
    // a rule table the registry refuses: the game type alone
  }
  if (option.custom) parts.push('any set');
  return parts.join(' · ');
}
