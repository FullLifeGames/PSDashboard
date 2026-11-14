import { dieKey, dieLabel, winPctText, type DieKind, type DieWords, type EvalLine, type EvalResult, type LineDie, type LineStep } from '@fulllifegames/eval-engine';
import { rulesDex, type GameRules, type TurnSnapshot } from '@fulllifegames/replay-core';
import { wordsOf } from './branch-dice';
import type { WinPathsHost } from './win-paths-host';

/**
 * Round 89 (#104), step G3: what the "Lines" section of the turn card shows, as plain data. One block per line (head, end value,
 * tooltip, note), one row per step (one row per player and step in doubles, ruled 13.11.2026), the chips by ruling 33, question 3a:
 * only a die that could have gone the other way (`LineDie.shown`, decided by the engine's `chipShown`); the tooltip of the play
 * button lists every die the click forces.
 */

type Side = 'p1' | 'p2';
type Battle = Parameters<typeof wordsOf>[0];
type Actives = { p1: string[]; p2: string[] };

export interface LineSideView { side: Side; player: string; text: string; chips: string[] }
export interface LineRowView { key: string; turn: string; sides: LineSideView[] }
export interface LineBlockView {
  key: string;
  line: EvalLine;
  player: string;
  /** "engine: Surf", "played: Hyper Voice" or "played the engine's move: Draining Kiss". */
  role: string;
  /** "row 23%, this line ends at 19%" when the card's row value is known, else "ends at 19% for <player>". */
  end: string;
  /** The win chance at the line's end, as the card prints one ("19%"). */
  endPct: string;
  /** The percentage the line's own row shows on the card ("23%"); null when the context holds none (a win-path line has none). */
  row: string | null;
  /** The answer the line meets and where the search ranks it; null when the context holds no ranking or the line opens with a replacement. */
  reply: LineReply | null;
  /** The row and the end print differently: the one sentence on why (`LINE_DIFFERS_SENTENCE`) belongs to the section. */
  differs: boolean;
  rows: LineRowView[];
  /** The title of the play button: every die the click forces. */
  tooltip: string;
  /** What the click leaves to the seed, in the words a player reads; null when it forces everything. */
  note: string | null;
  /** Why the line stops where it does, when its last position asks a player who to send in (a choice the tree did not make); else null. */
  endNote: string | null;
}

/** The question after ▶ Play on a line when a variation stands: it names the clicked line, so that line's block shows it (round 89, G4b). */
export interface LineConfirm {
  /** `lineAnchor` of the clicked line and its turn. */
  anchor: string;
  message: string;
  proceed: () => void;
  cancel: () => void;
}

/** One line of one graded turn: a side's engine line and played line differ in their label and roles. */
export const lineAnchor = (line: EvalLine, turn: number): string => `${turn}|${line.side}|${line.label}|${line.for.join('+')}`;

/** What the host of the turn card hands the Lines section: the game's rules, the field at the turn's start and the click. */
export interface LinesHost {
  rules: GameRules;
  /** The turn's start snapshot (the names the dice speak of); optional. */
  snapshot?: TurnSnapshot | null;
  /** The start snapshot of any turn: the Game review words the dice of a turn that is not the selected one (round 89, G4). */
  snapshotAt?: (turn: number) => TurnSnapshot | null;
  /** ▶ Play: the line from the start of the graded turn. */
  onPlay?: (line: EvalLine, turn: number) => void;
  /** The replace question a click raised; the block of its line shows it, so it stands where the user clicked. */
  confirm?: LineConfirm | null;
  /** Round 89 (#130): the win paths of a lost endgame (the Game review's Endgame row, the turn card's entry); absent: none. */
  winPaths?: WinPathsHost;
}

/**
 * Round 89 (#104), G11 (ruling G8a): the answer a line meets, named by its rank in the merged ranking of the search that holds the
 * lines. `rank` is the words inside the brackets ("Tzon's top choice", "Tzon's second choice in this search"); `off` marks an
 * answer that is not the top one, which the head explains in its title.
 */
export interface LineReply { label: string; rank: string; off: boolean }

/** The title on an answer that is not the top choice (G8a: the line meets what its tree explored most). */
export const REPLY_OFF_TOP_TITLE = "Each of the search's trees follows the answer it explored most, so a line can meet another answer than the top one.";

/** The labels of each side's ranked choices, best first, from the result that holds the lines. */
export const ranksOf = (result: Pick<EvalResult, 'perSide'>): { p1: string[]; p2: string[] } => ({
  p1: result.perSide.p1.map(choice => choice.label), p2: result.perSide.p2.map(choice => choice.label),
});

/** The percentages a side's rows show on the card, already printed ("23%"): the engine's row and the played row. */
export interface RowValues { engine?: string; played?: string }

/**
 * Round 89 (#104), G10 (ruling G5a): why a row's number and its line's end number differ. Shown once under the Lines section and once
 * under the Game review, and only when a line differs.
 */
export const LINE_DIFFERS_SENTENCE = "A row's value averages every answer and die the search tried; a line follows one answer with each die at its likeliest result.";

export interface LineViewContext {
  /** The graded turn: the line's first step plays it. */
  turn: number;
  /** The card's own row values by side (`rowValueTexts`): a line shows its row beside its end. Absent: the end alone. */
  rowValues?: { p1?: RowValues; p2?: RowValues };
  /** The labels of each side's ranked choices, best first (`ranksOf`): a line names the rank of the answer it meets. Absent: no rank. */
  ranks?: { p1: readonly string[]; p2: readonly string[] };
  playerNames: [string, string];
  doubles: boolean;
  rules: GameRules;
  /** The bodies on the field at the turn's start, by side and slot, for the names a die speaks of. */
  actives?: Actives;
}

const SIDE_INDEX: Record<Side, 0 | 1> = { p1: 0, p2: 1 };

/** The active bodies of a snapshot in slot order (a snapshot written before round 69 has no slot: field order). */
export function activeNamesAt(snapshot: TurnSnapshot | null | undefined): Actives | undefined {
  if (!snapshot) return undefined;
  const read = (side: Side): string[] => {
    const names: string[] = [];
    snapshot[side].pokemon.filter(mon => mon.isActive).forEach((mon, index) => { names[mon.slot ?? index] = mon.name; });
    return Array.from(names, name => name ?? '');
  };
  return { p1: read('p1'), p2: read('p2') };
}

/** The words of the dice for the game's rules; the ids stand in when the rules' Dex is not loaded. */
function wordsFor(rules: GameRules, actives: Actives): DieWords {
  let dex: unknown;
  try {
    dex = rulesDex(rules.gen, rules.mod);
  } catch {
    return { move: id => id, effect: id => id, slot: slot => slot };
  }
  // `wordsOf` reads two things of a battle: its Dex and the bodies on its sides.
  const stand = { dex, sides: (['p1', 'p2'] as const).map(side => ({ active: actives[side].map(name => ({ name })) })) };
  return wordsOf(stand as unknown as Battle);
}

/** A die in the engine's own words with the chance of the result the line takes (none for a sure one). */
export function dieText(entry: LineDie, words: DieWords): string {
  const base = dieLabel(entry.die, words);
  return entry.chance !== undefined && entry.chance < 1 ? `${base} (${Math.round(entry.chance * 100)}%)` : base;
}

/** The chip text of one die: `dieText`, a knock-out by the move that rolls it with the rolls that hold it. */
export function chipText(entry: LineDie, words: DieWords): string {
  const { die } = entry;
  if (die.name.kind === 'damage-roll' && entry.ko) return `${words.move(die.name.moveId)}: KO (${entry.ko.rolls} of ${entry.ko.of} rolls)`;
  return dieText(entry, words);
}

/**
 * The tooltip's line of one die: the roll the click forces, and when it decides a knock-out, in how many rolls (those say the
 * roll's chance, so the percentage stays out).
 */
const tooltipText = (entry: LineDie, words: DieWords): string =>
  entry.ko ? `${dieLabel(entry.die, words)} (KO in ${entry.ko.rolls} of ${entry.ko.of} rolls)` : dieText(entry, words);

/**
 * The words for one die of a step. A spread move draws one die per target; when a step holds several dice that differ only in their
 * target, the move's name carries the target ("Rock Slide → Urshifu"), so the reader can tell them apart.
 */
function wordsOfDie(entry: LineDie, step: LineStep, words: DieWords): DieWords {
  const { name } = entry.die;
  if (!name.targetSlot || !name.moveId) return words;
  const sameDie = (other: LineDie) => other.die.name.slot === name.slot && other.die.name.moveId === name.moveId
    && other.die.name.kind === name.kind && other.die.name.effectId === name.effectId && other.die.name.hit === name.hit;
  const targets = new Set(step.dice.filter(sameDie).map(other => other.die.name.targetSlot));
  if (targets.size < 2) return words;
  return { ...words, move: id => (id === name.moveId ? `${words.move(id)} → ${words.slot(name.targetSlot!)}` : words.move(id)) };
}

/** The bodies on the field after a step: a switch puts its Pokémon in the slot. */
function actAfter(actives: Actives, step: LineStep): Actives {
  const next: Actives = { p1: [...actives.p1], p2: [...actives.p2] };
  for (const side of ['p1', 'p2'] as const) {
    (side === 'p1' ? step.p1 : step.p2).slots.forEach((slot, index) => {
      if (slot?.kind === 'switch') next[side][index] = slot.pokemonName;
    });
  }
  return next;
}

/**
 * What the replay left to the stream, in words, and whether the words are plural. Every die kind of the engine has its entry (the
 * type holds it, and a spec walks `DIE_KINDS`): a kind without words printed its own name ("random target"; round 89, G4d).
 */
const DRAW_WORDS: Record<DieKind | 'unnamed draw', { words: string; plural: boolean }> = {
  'accuracy': { words: 'whether a move hits', plural: false },
  'crit': { words: 'critical hits', plural: true },
  'damage-roll': { words: 'the damage roll', plural: false },
  'secondary': { words: 'secondary effects', plural: true },
  'self-effect': { words: 'what a move does to its user', plural: false },
  'hit-count': { words: 'the number of hits of a multi-hit move', plural: false },
  'status-check': { words: 'whether a status stops a Pokémon from moving', plural: false },
  'stalling': { words: 'whether a stalling move works again', plural: false },
  'power': { words: 'a chance that changes a move\'s power', plural: false },
  'speed-tie': { words: 'speed ties', plural: true },
  'ability-proc': { words: 'abilities that trigger by chance', plural: true },
  'item-proc': { words: 'items that trigger by chance', plural: true },
  'move-first': { words: 'who moves first within a priority bracket', plural: false },
  'end-of-turn': { words: 'chances at the end of the turn', plural: true },
  'random-target': { words: 'random targets', plural: true },
  'drag': { words: 'which Pokémon a move drags in', plural: false },
  'unnamed draw': { words: 'sleep turns, random targets and similar draws', plural: true },
};

/** What the replay left to the stream, in words; null when it left nothing. */
function unforcedNote(line: EvalLine): string | null {
  if (!line.unforced || line.unforced.length === 0) return null;
  const parts = line.unforced.map(kind => (DRAW_WORDS as Record<string, { words: string; plural: boolean }>)[kind] ?? { words: kind.replace(/-/g, ' '), plural: false });
  const several = parts.length > 1 || parts[0].plural;
  return `The click cannot force ${parts.map(part => part.words).join(', ')}. The seed decides ${several ? 'them' : 'it'}.`;
}

/** "The line ends where Alice must choose who to send in": the position after the last step waits for a switch the tree never chose. */
function endNote(line: EvalLine, playerNames: [string, string]): string | null {
  if (!line.awaits) return null;
  const who = line.awaits === 'both' ? `${playerNames[0]} and ${playerNames[1]}` : playerNames[SIDE_INDEX[line.awaits]];
  return `The line ends where ${who} must choose who to send in; the search made no choice there.`;
}

const roleText = (line: EvalLine): string => {
  if (line.for.includes('engine') && line.for.includes('played')) return `played the engine's move: ${line.label}`;
  return `${line.for.includes('engine') ? 'engine' : 'played'}: ${line.label}`;
};

/** The numbered rows of one line, with the dice chips and the tooltip's list of every die. */
function stepViews(line: EvalLine, ctx: LineViewContext): { rows: LineRowView[]; every: string[] } {
  const rows: LineRowView[] = [];
  const every: string[] = [];
  let actives: Actives = ctx.actives ?? { p1: [], p2: [] };
  let turn = ctx.turn;
  line.steps.forEach((step, index) => {
    const words = wordsFor(ctx.rules, actives);
    // A replacement inside a turn has no number of its own; one that opens the line stands at the graded turn.
    const label = !step.replacement || index === 0 ? `T${turn++}` : '';
    const sides = (step.replacement === 'p1' ? ['p1'] : step.replacement === 'p2' ? ['p2'] : ['p1', 'p2']) as Side[];
    const views = sides.map((side): LineSideView => {
      const choice = side === 'p1' ? step.p1 : step.p2;
      const chips = choice.slots.flatMap(slot => slot?.dice ?? []).flatMap(die => {
        const entry = step.dice.find(candidate => dieKey(candidate.die.name) === dieKey(die.name));
        return entry?.shown ? [chipText(entry, wordsOfDie(entry, step, words))] : [];
      });
      return { side, player: ctx.playerNames[SIDE_INDEX[side]], text: step.replacement ? `replaces: ${choice.label}` : choice.label, chips };
    });
    // a replacement inside a turn (a pivot's switch, a faint's) plays on in the turn before it: its dice belong to that turn's number
    for (const entry of step.dice) every.push(`${label || `T${turn - 1}`}: ${tooltipText(entry, wordsOfDie(entry, step, words))}`);
    if (ctx.doubles) views.forEach((view, at) => rows.push({ key: `${index}-${view.side}`, turn: at === 0 ? label : '', sides: [view] }));
    else rows.push({ key: String(index), turn: label, sides: views });
    actives = actAfter(actives, step);
  });
  return { rows, every };
}

const RANK_WORDS = ['top choice', 'second choice', 'third choice'];

/**
 * The answer a line meets: the other side's choice in the line's first step, by its place in the ranking. A line that opens with a
 * replacement (the other side waits) meets no answer. A doubles answer is the pair's combined label.
 */
export function replyOf(line: EvalLine, ctx: Pick<LineViewContext, 'ranks' | 'playerNames'>): LineReply | null {
  const first = line.steps[0];
  if (!ctx.ranks || !first || first.replacement) return null;
  const other: Side = line.side === 'p1' ? 'p2' : 'p1';
  const label = first[other].label;
  const name = ctx.playerNames[SIDE_INDEX[other]];
  const at = ctx.ranks[other].indexOf(label);
  if (at < 0) return { label, rank: `not among ${name}'s ranked choices`, off: true };
  if (at === 0) return { label, rank: `${name}'s ${RANK_WORDS[0]}`, off: false };
  return { label, rank: `${name}'s ${RANK_WORDS[at] ?? `choice ${at + 1}`} in this search`, off: true };
}

/** The tooltip of ▶ Play: what the click does and every die it forces. */
function tooltipOf(every: string[]): string {
  const head = 'Play this line as a variation, with these dice';
  return every.length === 0 ? `${head}: none to force.` : `${head}:\n${every.join('\n')}`;
}

/**
 * The blocks of a turn's lines, player 1's lines first, each player's engine line before the played line. A player who played the
 * engine's move has one line (the engine marks it with both roles).
 */
export function lineBlocks(lines: readonly EvalLine[], ctx: LineViewContext): LineBlockView[] {
  const order = (line: EvalLine) => (line.side === 'p1' ? 0 : 2) + (line.for.includes('engine') ? 0 : 1);
  return [...lines].sort((a, b) => order(a) - order(b)).map((line, index) => {
    const { rows, every } = stepViews(line, ctx);
    const player = ctx.playerNames[SIDE_INDEX[line.side]];
    const endPct = winPctText(line.end, line.endFainted);
    // a line that holds the engine's role is the engine's row; a played-only line is the row the player played
    const row = ctx.rowValues?.[line.side]?.[line.for.includes('engine') ? 'engine' : 'played'] ?? null;
    return {
      key: `${line.side}-${line.label}-${index}`, line, player, role: roleText(line),
      end: row === null ? `ends at ${endPct} for ${player}` : `row ${row}, this line ends at ${endPct}`, endPct, row, differs: row !== null && row !== endPct, reply: replyOf(line, ctx),
      rows, tooltip: tooltipOf(every), note: unforcedNote(line), endNote: endNote(line, ctx.playerNames),
    };
  });
}
