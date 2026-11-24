import type { PokemonSet } from '@pkmn/sim';
import { dexOf, logRules, toId, type RulesDex } from '@fulllifegames/replay-core';

/** The oracle of `logged-move-corpus.spec.ts`: its own reading of a log, never the inference's `ownMove`. */

export type Via = 'own' | 'transform' | 'from-move';
export interface LoggedBody {
  side: 'p1' | 'p2';
  species: Set<string>;
  moves: Map<string, Set<Via>>;
  sharedNick: boolean;
}

const identOf = (text: string): { side: 'p1' | 'p2'; slot: string; nick: string; key: string } | null => {
  const match = /^(p[12])([a-d])?: (.*)$/.exec(text);
  return match ? { side: match[1] as 'p1' | 'p2', slot: `${match[1]}${match[2] ?? ''}`, nick: match[3], key: `${match[1]}|${match[3]}` } : null;
};
const detailsSpecies = (details: string | undefined): string => (details ?? '').split(',')[0].trim();

function fromOf(parts: string[]): { name: string; typed: string } | null {
  const raw = parts.slice(4).find(part => part.startsWith('[from]'));
  if (raw === undefined) return null;
  const text = raw.slice('[from]'.length).trim();
  const typed = /^(move|item|ability|pokemon|condition|weather|status|volatile): (.*)$/.exec(text);
  return typed ? { typed: typed[1], name: typed[2] } : { typed: '', name: text };
}

// A status Z-move prints "Z-" before its base move, a name the Dex does not list.
const poweredMove = (dex: RulesDex, name: string): boolean => {
  const move = dex.moves.get(name);
  return move.exists ? !!(move.isZ || move.isMax) : /^Z-/.test(name);
};

function bookedBy(dex: RulesDex, parts: string[]): { moves: string[]; via: Via } {
  const cmd = parts[1];
  const shown = cmd === 'cant' ? (parts[4] ?? '') : (parts[3] ?? '');
  if (!shown || toId(shown) === 'struggle') return { moves: [], via: 'own' };
  // A blocker's line (Dazzling, Damp) is `|cant|HOLDER|ability: X|ATTACKER'S MOVE|[of] ATTACKER`: the foe's move.
  if (cmd === 'cant' && /^ability:/.test(parts[3] ?? '')) return { moves: [], via: 'own' };
  const from = cmd === 'cant' ? null : fromOf(parts);
  if (!from) return { moves: poweredMove(dex, shown) ? [] : [shown], via: 'own' };
  const fromId = toId(from.name);
  const calls = !!dex.moves.get(from.name).callsMove;
  // Sleep Talk books the shown move, typed or not; Pursuit's switch hit is the body's own move.
  if (fromId === 'sleeptalk' || fromId === 'pursuit') return { moves: [shown], via: 'own' };
  if (from.typed === 'move') return calls ? { moves: [from.name], via: 'own' } : { moves: [shown], via: 'from-move' };
  // A type-less [from] books the caller only for a callsMove move; Magic Coat, Snatch, lockedmove, echoes book none.
  return { moves: !from.typed && calls ? [from.name] : [], via: 'own' };
}

// Ally Switch moves a body between slots without a switch line, so the slot is read only for shared nicknames.
export function loggedBodies(log: string): Map<string, LoggedBody> {
  const dex = dexOf(logRules(log));
  const bodies = new Map<string, LoggedBody>();
  const inSlot = new Map<string, string>();
  const baseId = (name: string) => toId(dex.species.get(name).baseSpecies || name);
  const shared = new Set<string>();
  const seen = new Map<string, string>();
  for (const line of log.split('\n')) {
    const parts = line.split('|');
    const ident = parts[1] === 'switch' || parts[1] === 'drag' ? identOf(parts[2] ?? '') : null;
    if (!ident) continue;
    const base = baseId(detailsSpecies(parts[3]));
    if ((seen.get(ident.key) ?? base) !== base) shared.add(ident.key);
    seen.set(ident.key, base);
  }
  const transformed = new Map<string, string>();
  const bodyOf = (key: string): LoggedBody => {
    let body = bodies.get(key);
    if (!body) bodies.set(key, body = { side: key.slice(0, 2) as 'p1' | 'p2', species: new Set(), moves: new Map(), sharedNick: key.split('|').length > 2 });
    return body;
  };
  const keyOf = (ident: NonNullable<ReturnType<typeof identOf>>) => (shared.has(ident.key) && inSlot.get(ident.slot)) || ident.key;
  const enter = (ident: NonNullable<ReturnType<typeof identOf>>, cmd: string, parts: string[]) => {
    const species = cmd === '-formechange' ? parts[3] : parts[3] && detailsSpecies(parts[3]);
    if (cmd === 'switch' || cmd === 'drag') {
      if (shared.has(ident.key)) inSlot.set(ident.slot, `${ident.key}|${baseId(species ?? '')}`);
      transformed.delete(keyOf(ident));
    }
    if (species) bodyOf(keyOf(ident)).species.add(species);
  };
  const book = (ident: NonNullable<ReturnType<typeof identOf>>, parts: string[]) => {
    const { moves, via } = bookedBy(dex, parts);
    let key = keyOf(ident);
    const own = key;
    for (let hop = 0; transformed.has(key) && hop < 3; hop++) key = transformed.get(key)!;
    for (const move of moves) bodyOf(key).moves.set(move, (bodyOf(key).moves.get(move) ?? new Set()).add(key === own ? via : 'transform'));
  };
  for (const line of log.split('\n')) {
    const parts = line.split('|');
    const ident = identOf(parts[2] ?? '');
    if (!ident) continue;
    const cmd = parts[1];
    if (['switch', 'drag', 'replace', 'detailschange', '-formechange'].includes(cmd)) enter(ident, cmd, parts);
    else if (cmd === '-transform') { const target = identOf(parts[3] ?? ''); if (target) transformed.set(keyOf(ident), keyOf(target)); }
    else if (cmd === 'move' || cmd === 'cant') book(ident, parts);
  }
  return bodies;
}

export interface Gap {
  side: 'p1' | 'p2';
  species: string;
  move: string;
  via: Via[];
  /** A move a `[from] move:` line shows is also held: the caller's booking takes a slot a fifth move then lacks. */
  fromMoveBody: boolean;
  /** The body may be a Zoroark behind its Illusion: its moves show in the log under another name. */
  illusion: boolean;
  /** Several species of the side share the nickname (the gen 2 log "???"): the inference cannot tell them apart. */
  sharedNick: boolean;
}

export interface SetsCheck { bodies: number; moves: number; held: number; unmatched: string[]; gaps: Gap[] }

// The same slot key: a typed Hidden Power answers a typeless one.
const slotKey = (dex: RulesDex, name: string): string => {
  const id = toId(name);
  return id.startsWith('hiddenpower') ? 'hiddenpower' : dex.moves.get(name).exists ? String(dex.moves.get(name).id) : id;
};

export function checkBuiltSets(log: string, teams: { p1Team: PokemonSet[]; p2Team: PokemonSet[] }): SetsCheck {
  const dex = dexOf(logRules(log));
  const baseId = (name: string) => toId(dex.species.get(name).baseSpecies || name);
  const result: SetsCheck = { bodies: 0, moves: 0, held: 0, unmatched: [], gaps: [] };
  const groups = new Map<string, { side: 'p1' | 'p2'; species: string; moves: Map<string, Set<Via>>; sharedNick: boolean }>();
  for (const [key, body] of loggedBodies(log)) {
    if (body.moves.size === 0) continue;
    const species = [...body.species][0] ?? key;
    const group = groups.get(`${body.side}|${baseId(species)}`) ?? { side: body.side, species, moves: new Map(), sharedNick: false };
    for (const [move, via] of body.moves) group.moves.set(move, new Set([...(group.moves.get(move) ?? []), ...via]));
    group.sharedNick ||= body.sharedNick;
    groups.set(`${body.side}|${baseId(species)}`, group);
  }
  for (const [groupKey, group] of groups) {
    const team = group.side === 'p1' ? teams.p1Team : teams.p2Team;
    const sets = team.filter(set => baseId(set.species) === groupKey.split('|')[1]);
    result.bodies++;
    if (sets.length === 0) { result.unmatched.push(`${group.side} ${group.species}`); continue; }
    const held = new Set(sets.flatMap(set => set.moves.map(move => slotKey(dex, move))));
    const fromMoveBody = [...group.moves.values()].some(via => via.has('from-move'));
    const illusion = team.some(set => Object.values(dex.species.get(set.species).abilities).includes('Illusion'));
    for (const [move, via] of group.moves) {
      result.moves++;
      if (held.has(slotKey(dex, move))) result.held++;
      else result.gaps.push({ side: group.side, species: group.species, move, via: [...via], fromMoveBody, illusion, sharedNick: group.sharedNick });
    }
  }
  return result;
}

export function ownerOf(gap: Gap): '#141' | '#139' | '#140' | 'shared-nickname' | null {
  if (gap.illusion) return '#141';
  if (gap.via.includes('transform')) return '#139';
  if (gap.fromMoveBody) return '#140';
  if (gap.sharedNick) return 'shared-nickname';
  return null;
}
