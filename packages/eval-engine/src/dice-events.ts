import { rulesDex, toId, type RulesDex, type RulesMod, type SideId, type TurnSnapshot } from '@fulllifegames/replay-core';
import { normalizeLines } from './line-endings.ts';

/**
 * Protocol-visible dice events, per turn — the anchor that keeps the
 * report's luck claims honest. The chance ledger (chanceDelta) is a
 * RESIDUAL: rolls, crits, reveals, and model error all land in it, so its
 * net can point away from the dice a player actually saw (the draft game:
 * net chance toward the winner while both crits and both Flame Body burns
 * hit the winner). These turns carry an event the protocol itself shows to
 * be rolled; summing the ledger over them grounds or contradicts the claim.
 *
 * Deliberately coarse: damage rolls emit no protocol marker (a max-roll
 * game shows no event here), and a bare |-status| can come from a
 * deterministic source the line does not name. The report therefore treats
 * the anchor asymmetrically — only an ACTIVE contradiction demotes a luck
 * claim; a weak or empty anchor changes nothing. Extensible with confusion
 * self-hits and OHKO moves if a game ever needs them.
 */

/** |cant| reasons that are dice: full paralysis, flinch, freeze, sleep.
 * (Rest sleep is fixed-length — a documented over-inclusion.) */
export const CHANCE_CANT: ReadonlySet<string> = new Set(['slp', 'par', 'frz', 'flinch']);

type GenDex = RulesDex;

/** Round 75 (T160): the Dex of a replay's generation and mod (the Champions mod changes accuracies and secondaries); absent without a generation. */
const dexOfGeneration = (generation: number | undefined, mod: RulesMod): GenDex | undefined =>
  generation === undefined ? undefined : rulesDex(generation, mod);

/** The Dex and the move whose action is running at a line; null keeps the markers as the protocol alone shows them. */
type DiceContext = { dex: GenDex; running: string | null } | null;

/**
 * Round 69 (T177): whether a move's own dice can decide a status it lands: an accuracy under 100 (Hypnosis, Toxic,
 * Thunder Wave from Gen 7 on) or a status chance under 100 (Scald's burn; Tri Attack's, which a handler picks).
 * Thunder Wave in Gen 6 (accuracy 100), Toxic Spikes and Rest (accuracy true) roll nothing.
 */
function moveRollsStatus(dex: GenDex, id: string): boolean {
  const move = dex.moves.get(id);
  if (typeof move.accuracy === 'number' && move.accuracy < 100) return true;
  const effects = move.secondaries ?? (move.secondary ? [move.secondary] : []);
  // A secondary that names only its chance picks its effect in a handler (Tri Attack, Dire Claw): its status is rolled too.
  // Round 75 (T160): the simulator's Dex keeps the handler on the secondary (onHit), the data-only Dex of before dropped it: a function is no field.
  return effects.some(effect => (effect.chance ?? 100) < 100
    && (effect.status !== undefined || Object.entries(effect).every(([key, value]) => key === 'chance' || typeof value === 'function')));
}

/** A bare or `[from] move:` status is a roll when its source's dice can decide it; with no running move (a hazard on a switch-in, a residual) it is none. */
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
    // Without a generation: a named non-ability source (move: Rest, item: Flame Orb, hazards) is
    // deterministic; a bare status (move secondary, direct status move) and an ability source (Flame
    // Body, Static) are rolled. With one (round 69, T177): the source's own Dex entry decides.
    const from = line.split('|').find(part => part.startsWith('[from]'));
    return context ? statusRolls(from, context) : from === undefined || from.startsWith('[from] ability:');
  }
  return false;
}

/** The tags that close a move's action: the next action, the residual phase (the empty line), the turn's end. */
const ACTION_END: ReadonlySet<string> = new Set(['move', 'switch', 'drag', 'cant', 'upkeep', 'turn', '']);

/** Per line of a turn: whether it is a dice marker, with the running move read for the generation's Dex. */
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

/**
 * Turns whose protocol carries at least one visible dice event; the index is by turn (entry 0 stays empty).
 * Round 69 (T177): with the replay generation a sure crit and a status no dice decided are no event. Round 70 (T206): every turn's
 * lines pass the door for line endings (normalizeLines) before they are read.
 */
export function diceEventTurns(turnEventsIndex: readonly (readonly string[])[], generation?: number, mod?: RulesMod): Set<number> {
  const turns = new Set<number>();
  turnEventsIndex.forEach((lines, turn) => {
    if (turn >= 1 && diceMarks(normalizeLines(lines), generation, mod).some(Boolean)) turns.add(turn);
  });
  return turns;
}

/** Round 67 (T22): one hit of a move on an opposing body. */
export interface RolledHit {
  side: SideId;
  /** The move's id, as the |move| line names it. */
  move: string;
  /** The body's species: its switch line this turn, else the pre-turn snapshot. */
  target: string;
  /** Round 69 (T177): the attacker's slot ("p1a", "p2b"), so a doubles hit names who used the move. */
  slot: string;
  /** Round 69 (T177): the attacker's species, read like the target's; absent when no line names it. */
  attacker?: string;
  /** The hit took the body's last HP (a |-damage| to 0 without [from]). */
  ko: boolean;
}

/**
 * Round 67 (T22): what one turn's protocol shows of its rolls. `favored`
 * marks the side each dice marker went for: the side opposing the body the
 * dice went against (the crit's target, the missing attacker, the body a
 * dice |cant| held, the body a rolled status landed on; every marker names
 * that body first). `hits` keeps every hit of a move on an opposing body,
 * so a played line's KO odds can be read against what happened
 * (turn-analysis/luck.ts). Damage rolls still leave no marker: a hit is no
 * roll by itself.
 */
export interface TurnRolls {
  favored: { p1: boolean; p2: boolean };
  hits: RolledHit[];
}

const sideOfIdent = (ident: string | undefined): SideId | null =>
  ident?.startsWith('p1') ? 'p1' : ident?.startsWith('p2') ? 'p2' : null;

/** Who entered each slot this turn (slot ident → name and species). */
type Entered = Map<string, { name: string; species: string }>;

/** The species behind an ident: the slot's switch line this turn, else the pre-turn snapshot (nickname, then species). */
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

/** The move whose action is running: its side, its id, and the bodies it has hit so far. */
interface RunningAction {
  side: SideId;
  /** The attacker's ident ("p1a: Name"). */
  ident: string;
  move: string;
  hits: Map<string, RolledHit>;
}

/** One direct |-damage| line on an opposing body extends the running action's hits (a multi-hit move stays one hit). */
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

/** The running action after one line: a move line opens one, an action end closes it. */
function nextAction(action: RunningAction | null, tag: string, parts: string[]): RunningAction | null {
  if (tag === 'move') {
    const side = sideOfIdent(parts[2]);
    return side ? { side, ident: parts[2] ?? '', move: toId(parts[3] ?? ''), hits: new Map() } : null;
  }
  return ACTION_END.has(tag) ? null : action;
}

/** A switch or drag line names the slot's new body ("p1a: Name", "Species, L50, F"). */
function noteEntry(entered: Entered, parts: string[]): void {
  const ident = parts[2] ?? '';
  entered.set(ident.slice(0, 3), { name: ident.slice(5), species: (parts[3] ?? '').split(',')[0].trim() });
}

/**
 * Round 67 (T22): the sides a turn's dice markers favored and the hits its moves put on opposing bodies.
 * Round 69 (T177): with the replay generation, the markers of a sure crit and of a status no dice decided are no roll.
 * Round 70 (T206): the lines pass the door for line endings (normalizeLines) first; a '\r' at the end of a damage line hid its KO.
 */
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
