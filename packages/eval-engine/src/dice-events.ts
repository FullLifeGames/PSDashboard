import { rulesDex, toId, type RulesDex, type RulesMod, type SideId, type TurnSnapshot } from '@fulllifegames/replay-core';
import { normalizeLines } from './line-endings.ts';

// Coarse on purpose: damage rolls emit no marker, and a bare |-status| can come from a deterministic source.

// Rest sleep is fixed-length (a documented over-inclusion); the simulator writes the infatuation as "Attract".
// eslint-disable-next-line names/no-new-dex-name -- the simulator's |cant| reason (the infatuation's condition name), held by pair-cant-reasons.spec.ts
export const CHANCE_CANT: ReadonlySet<string> = new Set(['slp', 'par', 'frz', 'flinch', 'Attract']);

type GenDex = RulesDex;

const dexOfGeneration = (generation: number | undefined, mod: RulesMod): GenDex | undefined =>
  generation === undefined ? undefined : rulesDex(generation, mod);

type DiceContext = { dex: GenDex; running: string | null } | null;

function moveRollsStatus(dex: GenDex, id: string): boolean {
  const move = dex.moves.get(id);
  if (typeof move.accuracy === 'number' && move.accuracy < 100) return true;
  const effects = move.secondaries ?? (move.secondary ? [move.secondary] : []);
  // A secondary that names only its chance picks its effect in a handler (Tri Attack, Dire Claw): its status is rolled.
  return effects.some(effect => (effect.chance ?? 100) < 100
    && (effect.status !== undefined || Object.entries(effect).every(([key, value]) => key === 'chance' || typeof value === 'function')));
}

function statusRolls(from: string | undefined, context: NonNullable<DiceContext>): boolean {
  if (from === undefined) return context.running !== null && moveRollsStatus(context.dex, context.running);
  if (from.startsWith('[from] ability:')) return true;
  return from.startsWith('[from] move:') && moveRollsStatus(context.dex, toId(from.slice('[from] move:'.length)));
}

function diceLine(line: string, context: DiceContext): boolean {
  if (line.startsWith('|-crit|')) return !context || context.running === null || !context.dex.moves.get(context.running).willCrit;
  if (line.startsWith('|-miss|')) return true;
  if (line.startsWith('|move|') && line.includes('|[miss]')) return true;
  if (line.startsWith('|cant|')) return CHANCE_CANT.has(line.split('|')[3] ?? '');
  if (line.startsWith('|-status|')) {
    // Without a generation: a named non-ability source (Rest, Flame Orb, hazards) is deterministic; a bare status or an
    // ability source (Flame Body, Static) rolls. With one, the source's own Dex entry decides.
    const from = line.split('|').find(part => part.startsWith('[from]'));
    return context ? statusRolls(from, context) : from === undefined || from.startsWith('[from] ability:');
  }
  return false;
}

const ACTION_END: ReadonlySet<string> = new Set(['move', 'switch', 'drag', 'cant', 'upkeep', 'turn', '']);

function diceMarks(lines: readonly string[], generation: number | undefined, mod: RulesMod): boolean[] {
  const dex = dexOfGeneration(generation, mod);
  let running: string | null = null;
  return lines.map(line => {
    const tag = line.split('|')[1] ?? '';
    if (tag === 'move') running = toId(line.split('|')[3] ?? '');
    else if (ACTION_END.has(tag)) running = null;
    return diceLine(line, dex ? { dex, running } : null);
  });
}

/** Entry 0 stays empty; with the generation a sure crit and a status no dice decided are no event. */
export function diceEventTurns(turnEventsIndex: readonly (readonly string[])[], generation?: number, mod?: RulesMod): Set<number> {
  const turns = new Set<number>();
  turnEventsIndex.forEach((lines, turn) => {
    if (turn >= 1 && diceMarks(normalizeLines(lines), generation, mod).some(Boolean)) turns.add(turn);
  });
  return turns;
}

export interface RolledHit {
  side: SideId;
  move: string;
  target: string;
  slot: string;
  attacker?: string;
  /** The hit took the body's last HP (a |-damage| to 0 without [from]). */
  ko: boolean;
}

export interface TurnRolls {
  /** The side opposing the body each dice marker went against (crit target, missing attacker, |cant| holder). */
  favored: { p1: boolean; p2: boolean };
  hits: RolledHit[];
}

const sideOfIdent = (ident: string | undefined): SideId | null =>
  ident?.startsWith('p1') ? 'p1' : ident?.startsWith('p2') ? 'p2' : null;

type Entered = Map<string, { name: string; species: string }>;

function speciesOf(ident: string, entered: Entered, snapshotBefore: TurnSnapshot | null): string | null {
  const match = ident.match(/^(p[12])([a-d]): (.+)$/);
  if (!match) return null;
  const nameId = toId(match[3]);
  const switched = entered.get(`${match[1]}${match[2]}`);
  if (switched && toId(switched.name) === nameId) return switched.species;
  const roster = snapshotBefore?.[match[1] as SideId].pokemon ?? [];
  return roster.find(pokemon => toId(pokemon.name) === nameId)?.speciesForme
    ?? roster.find(pokemon => toId(pokemon.speciesForme) === nameId)?.speciesForme ?? null;
}

interface RunningAction {
  side: SideId;
  ident: string;
  move: string;
  hits: Map<string, RolledHit>;
}

function noteHit(action: RunningAction, parts: string[], scan: { entered: Entered; snapshotBefore: TurnSnapshot | null; hits: RolledHit[] }): void {
  if (parts.some(part => part.startsWith('[from]'))) return;
  const ident = parts[2] ?? '';
  const side = sideOfIdent(ident);
  if (!side || side === action.side) return;
  const ko = parts[3] === '0 fnt';
  const known = action.hits.get(ident);
  if (known) {
    known.ko ||= ko;
    return;
  }
  const target = speciesOf(ident, scan.entered, scan.snapshotBefore);
  if (target === null) return;
  const attacker = speciesOf(action.ident, scan.entered, scan.snapshotBefore);
  const hit: RolledHit = {
    side: action.side, move: action.move, target, slot: action.ident.slice(0, 3), ko,
    ...(attacker !== null ? { attacker } : {}),
  };
  action.hits.set(ident, hit);
  scan.hits.push(hit);
}

function nextAction(action: RunningAction | null, tag: string, parts: string[]): RunningAction | null {
  if (tag === 'move') {
    const side = sideOfIdent(parts[2]);
    return side ? { side, ident: parts[2] ?? '', move: toId(parts[3] ?? ''), hits: new Map() } : null;
  }
  return ACTION_END.has(tag) ? null : action;
}

function noteEntry(entered: Entered, parts: string[]): void {
  const ident = parts[2] ?? '';
  entered.set(ident.slice(0, 3), { name: ident.slice(5), species: (parts[3] ?? '').split(',')[0].trim() });
}

export function detectRolls(rawLines: readonly string[], snapshotBefore: TurnSnapshot | null, generation?: number, mod?: RulesMod): TurnRolls {
  const lines = normalizeLines(rawLines);
  const favored = { p1: false, p2: false };
  const scan = { entered: new Map() as Entered, snapshotBefore, hits: [] as RolledHit[] };
  const marks = diceMarks(lines, generation, mod);
  let action: RunningAction | null = null;
  for (const [index, line] of lines.entries()) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    const victim = marks[index] ? sideOfIdent(parts[2]) : null;
    if (victim) favored[victim === 'p1' ? 'p2' : 'p1'] = true;
    action = nextAction(action, tag, parts);
    if (tag === 'switch' || tag === 'drag') noteEntry(scan.entered, parts);
    else if (tag === '-damage' && action) noteHit(action, parts, scan);
  }
  return { favored, hits: scan.hits };
}
