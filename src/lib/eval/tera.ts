import type { TeraAllowance } from './types';

/**
 * Tera-rights resolution. Draft leagues grant Terastallization to specific
 * drafted Pokémon — a global on/off would let the engine recommend illegal
 * Teras and price floors against impossible opponent Teras. Pure, sim-free.
 */

export type TeraPreference = 'auto' | 'on' | 'off' | 'revealed';

/** Formats where Tera rights belong to individual Pokémon, not everyone. */
const PER_POKEMON_TERA_FORMATS = /draft|customgame/;

const sideOf = (ref: string): 'p1' | 'p2' | null =>
  ref.startsWith('p1') ? 'p1' : ref.startsWith('p2') ? 'p2' : null;

const nicknameOf = (ref: string): string => ref.replace(/^p[12][a-c]: /, '');

type SpeciesByNick = Record<'p1' | 'p2', Map<string, string>>;
type Revealed = { p1: string[]; p2: string[] };

/** A switch-family line maps the slot's nickname to its species. */
function noteSwitchLine(parts: string[], species: SpeciesByNick): void {
  const side = sideOf(parts[2] ?? '');
  if (!side) return;
  const name = (parts[3] ?? '').split(',')[0].trim();
  if (name) species[side].set(nicknameOf(parts[2] ?? ''), name);
}

/** A terastallize line reveals the nickname's species (the nickname itself when no switch named it). */
function noteTeraLine(parts: string[], species: SpeciesByNick, revealed: Revealed): void {
  const side = sideOf(parts[2] ?? '');
  if (!side) return;
  const nick = nicknameOf(parts[2] ?? '');
  const name = species[side].get(nick) ?? nick;
  if (!revealed[side].includes(name)) revealed[side].push(name);
}

/**
 * The species that actually terastallized in the replay, per side —
 * `|-terastallize|` names nicknames, resolved through the switch lines.
 */
export function parseRevealedTeraSpecies(log: string): { p1: string[]; p2: string[] } {
  const species: SpeciesByNick = { p1: new Map(), p2: new Map() };
  const revealed = { p1: [] as string[], p2: [] as string[] };
  for (const line of log.split('\n')) {
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

/**
 * Resolves the panel preference against the replay. 'auto' restricts
 * per-Pokémon-rights formats (draft, custom game) to the revealed species;
 * ladder formats keep the global switch — there everyone genuinely may Tera.
 */
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

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Stable, store-key-safe encoding of an allowance. */
export function teraKey(tera: TeraAllowance | undefined): string {
  if (tera === undefined || tera === true) return '1';
  if (tera === false) return '0';
  const encode = (list: string[]) => [...list].map(slug).sort().join('.');
  return `r-${encode(tera.p1)}-${encode(tera.p2)}`;
}
