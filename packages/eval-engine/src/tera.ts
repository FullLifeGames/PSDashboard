import type { TeraAllowance } from './types.ts';
import { toId } from '@fulllifegames/replay-core';
import { normalizeLineEndings } from './line-endings.ts';

// Draft leagues grant Terastallization to specific Pokémon: a global on/off would recommend illegal Teras.

/** The panel's Tera setting. */
export type TeraPreference = 'auto' | 'on' | 'off' | 'revealed';

const PER_POKEMON_TERA_FORMATS = /draft|customgame/;

const sideOf = (ref: string): 'p1' | 'p2' | null =>
  ref.startsWith('p1') ? 'p1' : ref.startsWith('p2') ? 'p2' : null;

const nicknameOf = (ref: string): string => ref.replace(/^p[12][a-c]: /, '');

type SpeciesByNick = Record<'p1' | 'p2', Map<string, string>>;
type Revealed = { p1: string[]; p2: string[] };

function noteSwitchLine(parts: string[], species: SpeciesByNick): void {
  const side = sideOf(parts[2] ?? '');
  if (!side) return;
  const name = (parts[3] ?? '').split(',')[0].trim();
  if (name) species[side].set(nicknameOf(parts[2] ?? ''), name);
}

function noteTeraLine(parts: string[], species: SpeciesByNick, revealed: Revealed): void {
  const side = sideOf(parts[2] ?? '');
  if (!side) return;
  const nick = nicknameOf(parts[2] ?? '');
  const name = species[side].get(nick) ?? nick;
  if (!revealed[side].includes(name)) revealed[side].push(name);
}

/** Species that terastallized per side: `|-terastallize|` names nicknames, resolved through the switch lines. */
export function parseRevealedTeraSpecies(rawLog: string): { p1: string[]; p2: string[] } {
  const species: SpeciesByNick = { p1: new Map(), p2: new Map() };
  const revealed = { p1: [] as string[], p2: [] as string[] };
  for (const line of normalizeLineEndings(rawLog).split('\n')) {
    const parts = line.split('|');
    const tag = parts[1];
    if (tag === 'switch' || tag === 'drag' || tag === 'replace') {
      noteSwitchLine(parts, species);
    } else if (tag === '-terastallize') {
      noteTeraLine(parts, species, revealed);
    }
  }
  return revealed;
}

/** Resolves the panel setting; 'auto' limits draft and custom game formats to the revealed species. */
export function resolveTeraPreference(
  pref: TeraPreference,
  formatid: string,
  log: string,
): TeraAllowance {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  if (!log.includes('|-terastallize|')) return false;
  if (pref === 'revealed' || PER_POKEMON_TERA_FORMATS.test(formatid)) {
    return parseRevealedTeraSpecies(log);
  }
  return true;
}

/** A stable, store-key-safe encoding of an allowance. */
export function teraKey(tera: TeraAllowance | undefined): string {
  if (tera === undefined || tera === true) return '1';
  if (tera === false) return '0';
  const encode = (list: string[]) => [...list].map(toId).sort().join('.');
  return `r-${encode(tera.p1)}-${encode(tera.p2)}`;
}
