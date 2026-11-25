import { dieKey, dieLabel, replacementWords, winPctText, type DieKind, type DieWords, type EvalLine, type EvalResult, type LineChoice, type LineDie, type LineStep } from '@fulllifegames/eval-engine';
import { rulesDex, type GameRules, type TurnSnapshot } from '@fulllifegames/replay-core';
import { wordsOf } from './branch-dice';
import type { WinPathsHost } from './win-paths-host';
import { sameAnswer, type WorstLookup } from './worst-reply';


type Side = 'p1' | 'p2';
type Battle = Parameters<typeof wordsOf>[0];
type Actives = { p1: string[]; p2: string[] };

export interface LineSideView { side: Side; player: string; text: string; chips: string[] }
export interface LineRowView { key: string; turn: string; sides: LineSideView[] }
export interface LineBlockView {
  key: string;
  line: EvalLine;
  player: string;
  role: string;
  end: string;
  endPct: string;
  /** The percentage the line's own row shows; null when the context holds none (a win-path line has none). */
  row: string | null;
  reply: LineReply | null;
  differs: boolean;
  rows: LineRowView[];
  tooltip: string;
  note: string | null;
  endNote: string | null;
  worstNote: string | null;
}

export interface LineConfirm {
  anchor: string;
  message: string;
  proceed: () => void;
  cancel: () => void;
}

export const lineAnchor = (line: EvalLine, turn: number): string => `${turn}|${line.side}|${line.label}|${line.for.join('+')}${line.versus ? `|${line.versus}` : ''}`;

export interface LinesHost {
  rules: GameRules;
  snapshot?: TurnSnapshot | null;
  snapshotAt?: (turn: number) => TurnSnapshot | null;
  onPlay?: (line: EvalLine, turn: number) => void;
  confirm?: LineConfirm | null;
  winPaths?: WinPathsHost;
  earlyLines?: { done: number; total: number; stop: () => void } | null;
  hardMode?: boolean;
  /** What a turn without lines waits for: "stage" (the early-lines search) or "sweep" (the game analysis runs). */
  lineComing?: (turn: number) => 'stage' | 'sweep' | null;
}

/** `rank` is the words inside the brackets ("Tzon's top choice"); `off` marks an answer that is not the top one. */
export interface LineReply { label: string; rank: string; off: boolean }

export const REPLY_OFF_TOP_TITLE = "Each of the search's trees follows the answer it explored most, so a line can meet another answer than the top one.";

export const ranksOf = (result: Pick<EvalResult, 'perSide'>): { p1: string[]; p2: string[] } => ({
  p1: result.perSide.p1.map(choice => choice.label), p2: result.perSide.p2.map(choice => choice.label),
});

export interface RowValues { engine?: string; played?: string }

export const LINE_DIFFERS_SENTENCE = "A row's value averages every answer and die the search tried; a line follows one answer with each die at its likeliest result.";

// 100% only shows for an ended evaluation (`winPercent`), so "averages" does not describe such a row.
export const LINE_PROVEN_SENTENCE = 'A row at 100% (or 0%) is one where every answer and die ends the game; its line stops before the game ends, so its end is the estimate of the position it stops at.';

export function differsSentences(blocks: readonly Pick<LineBlockView, 'differs' | 'row'>[]): string[] {
  const differing = blocks.filter(block => block.differs);
  if (differing.length === 0) return [];
  return differing.some(block => block.row === '100%' || block.row === '0%') ? [LINE_DIFFERS_SENTENCE, LINE_PROVEN_SENTENCE] : [LINE_DIFFERS_SENTENCE];
}

export interface LineViewContext {
  turn: number;
  rowValues?: { p1?: RowValues; p2?: RowValues };
  /** Sides whose body was knocked out before it moved (`neverActedOf`): their played line is a stand-in. */
  neverActed?: { p1?: boolean; p2?: boolean };
  ranks?: { p1: readonly string[]; p2: readonly string[] };
  playerNames: [string, string];
  doubles: boolean;
  rules: GameRules;
  actives?: Actives;
  worst?: WorstLookup;
}

const SIDE_INDEX: Record<Side, 0 | 1> = { p1: 0, p2: 1 };

export function activeNamesAt(snapshot: TurnSnapshot | null | undefined): Actives | undefined {
  if (!snapshot) return undefined;
  const read = (side: Side): string[] => {
    const names: string[] = [];
    snapshot[side].pokemon.filter(mon => mon.isActive).forEach((mon, index) => { names[mon.slot ?? index] = mon.name; });
    return Array.from(names, name => name ?? '');
  };
  return { p1: read('p1'), p2: read('p2') };
}

function wordsFor(rules: GameRules, actives: Actives): DieWords {
  let dex: unknown;
  try {
    dex = rulesDex(rules.gen, rules.mod);
  } catch {
    return { move: id => id, effect: id => id, slot: slot => slot };
  }
  const stand = { dex, sides: (['p1', 'p2'] as const).map(side => ({ active: actives[side].map(name => ({ name })) })) };
  return wordsOf(stand as unknown as Battle);
}

export function dieText(entry: LineDie, words: DieWords): string {
  const base = dieLabel(entry.die, words);
  return entry.chance !== undefined && entry.chance < 1 ? `${base} (${Math.round(entry.chance * 100)}%)` : base;
}

// Read against the boundary the simulator found (`ko`), not the die's class: a roll below it does not knock out.
function rollOutcome(entry: LineDie): { text: string; rolls: number } | null {
  const { die, ko } = entry;
  if (die.name.kind !== 'damage-roll' || !ko || !('step' in die.result)) return null;
  const knocks = die.result.step >= ko.of - ko.rolls;
  return { text: knocks ? 'KO' : 'no KO', rolls: knocks ? ko.rolls : ko.of - ko.rolls };
}

export function chipText(entry: LineDie, words: DieWords): string {
  const outcome = rollOutcome(entry);
  if (outcome && entry.die.name.kind === 'damage-roll') return `${words.move(entry.die.name.moveId)}: ${outcome.text} (${outcome.rolls} of ${entry.ko!.of} rolls)`;
  return dieText(entry, words);
}

const tooltipText = (entry: LineDie, words: DieWords): string => {
  const outcome = rollOutcome(entry);
  return outcome ? `${dieLabel(entry.die, words)} (${outcome.text} in ${outcome.rolls} of ${entry.ko!.of} rolls)` : dieText(entry, words);
};

// Dice of a spread-move step that differ only in target get the target in the move's name ("Rock Slide → Urshifu").
function wordsOfDie(entry: LineDie, step: LineStep, words: DieWords): DieWords {
  const { name } = entry.die;
  if (!name.targetSlot || !name.moveId) return words;
  const sameDie = (other: LineDie) => other.die.name.slot === name.slot && other.die.name.moveId === name.moveId
    && other.die.name.kind === name.kind && other.die.name.effectId === name.effectId && other.die.name.hit === name.hit;
  const targets = new Set(step.dice.filter(sameDie).map(other => other.die.name.targetSlot));
  if (targets.size < 2) return words;
  return { ...words, move: id => (id === name.moveId ? `${words.move(id)} → ${words.slot(name.targetSlot!)}` : words.move(id)) };
}

function actAfter(actives: Actives, step: LineStep): Actives {
  const next: Actives = { p1: [...actives.p1], p2: [...actives.p2] };
  for (const side of ['p1', 'p2'] as const) {
    (side === 'p1' ? step.p1 : step.p2).slots.forEach((slot, index) => {
      if (slot?.kind === 'switch') next[side][index] = slot.pokemonName;
    });
  }
  return next;
}

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

function unforcedNote(line: EvalLine): string | null {
  if (!line.unforced || line.unforced.length === 0) return null;
  const parts = line.unforced.map(kind => (DRAW_WORDS as Record<string, { words: string; plural: boolean }>)[kind] ?? { words: kind.replace(/-/g, ' '), plural: false });
  const several = parts.length > 1 || parts[0].plural;
  return `The click cannot force ${parts.map(part => part.words).join(', ')}. The seed decides ${several ? 'them' : 'it'}.`;
}

function endNote(line: EvalLine, playerNames: [string, string]): string | null {
  if (!line.awaits) return null;
  const who = line.awaits === 'both' ? `${playerNames[0]} and ${playerNames[1]} send in their replacements` : `${playerNames[SIDE_INDEX[line.awaits]]} sends in a replacement`;
  return `The line stops before ${who}. Its end is the board before the switch-in.`;
}

const roleText = (line: EvalLine, neverActed = false): string => {
  if (neverActed) return line.for.includes('engine') ? `engine: ${line.label}` : `staying in: ${line.label}`;
  if (line.for.includes('engine') && line.for.includes('played')) return `played the engine's move: ${line.label}`;
  return `${line.for.includes('engine') ? 'engine' : 'played'}: ${line.label}`;
};

function onlyChoiceNote(choice: LineChoice): string {
  const held = choice.onlyChoice ?? [];
  const slots = choice.slots.flatMap((slot, index) => (slot ? [{ slot, held: held.includes(index) }] : []));
  if (held.length === 0) return '';
  if (slots.length < 2 || slots.every(entry => entry.held)) return ' (only choice)';
  return ` (only choice: ${slots.filter(entry => entry.held).map(({ slot }) => (slot.kind === 'switch' ? `→ ${slot.pokemonName}` : slot.moveName)).join(' and ')})`;
}

function stepViews(line: EvalLine, ctx: LineViewContext): { rows: LineRowView[]; every: string[] } {
  const rows: LineRowView[] = [];
  const every: string[] = [];
  let actives: Actives = ctx.actives ?? { p1: [], p2: [] };
  let turn = ctx.turn;
  line.steps.forEach((step, index) => {
    const words = wordsFor(ctx.rules, actives);
    const label = !step.replacement || index === 0 ? `T${turn++}` : '';
    const sides = (step.replacement === 'p1' ? ['p1'] : step.replacement === 'p2' ? ['p2'] : ['p1', 'p2']) as Side[];
    const views = sides.map((side): LineSideView => {
      const choice = side === 'p1' ? step.p1 : step.p2;
      const chips = choice.slots.flatMap(slot => slot?.dice ?? []).flatMap(die => {
        const entry = step.dice.find(candidate => dieKey(candidate.die.name) === dieKey(die.name));
        return entry?.shown ? [chipText(entry, wordsOfDie(entry, step, words))] : [];
      });
      return { side, player: ctx.playerNames[SIDE_INDEX[side]], text: `${step.replacement ? `replaces: ${replacementWords(choice.label)}` : choice.label}${onlyChoiceNote(choice)}`, chips };
    });
    // A replacement inside a turn plays on in the turn before it: its dice belong to that turn's number.
    for (const entry of step.dice) every.push(`${label || `T${turn - 1}`}: ${tooltipText(entry, wordsOfDie(entry, step, words))}`);
    if (ctx.doubles) views.forEach((view, at) => rows.push({ key: `${index}-${view.side}`, turn: at === 0 ? label : '', sides: [view] }));
    else rows.push({ key: String(index), turn: label, sides: views });
    actives = actAfter(actives, step);
  });
  return { rows, every };
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export function rankWords(rank: number): string {
  if (rank <= 1) return 'top choice';
  if (rank < ORDINALS.length) return `${ORDINALS[rank]} choice`;
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th';
  return `${rank}${suffix} choice`;
}

const RATES_LOWEST = 'the reply the search rates lowest for this choice';

/** The other side's choice in the line's first step, by ranking place; a line opening with a replacement meets none. */
export function replyOf(line: EvalLine, ctx: Pick<LineViewContext, 'ranks' | 'playerNames' | 'worst'>): LineReply | null {
  const first = line.steps[0];
  if (!ctx.ranks || !first || first.replacement) return null;
  const other: Side = line.side === 'p1' ? 'p2' : 'p1';
  const label = first[other].label;
  const name = ctx.playerNames[SIDE_INDEX[other]];
  const hurt = ctx.worst?.(line.side, line);
  if (hurt && hurt.basis !== 'best' && sameAnswer(hurt.label, label)) {
    const stands = hurt.basis === 'punisher' ? ', from a thinly searched cell' : hurt.cell === null ? '' : `, ${hurt.cell} in its cell`;
    return { label, rank: `${RATES_LOWEST}${stands}`, off: false };
  }
  const at = ctx.ranks[other].findIndex(ranked => sameAnswer(ranked, label));
  if (at < 0) return { label, rank: `not among ${name}'s ranked choices`, off: true };
  if (at === 0) return { label, rank: `${name}'s ${rankWords(1)}`, off: false };
  return { label, rank: `${name}'s ${rankWords(at + 1)} in this search`, off: true };
}

function worstNote(line: EvalLine, reply: LineReply | null, ctx: Pick<LineViewContext, 'worst'>): string | null {
  const hurt = ctx.worst?.(line.side, line);
  if (!hurt || hurt.basis === 'best' || !reply || sameAnswer(hurt.label, reply.label)) return null;
  return `No line against ${hurt.label}, ${RATES_LOWEST}. This line meets ${reply.label}.`;
}

function tooltipOf(every: string[]): string {
  const head = 'Play this line as a variation, with these dice';
  return every.length === 0 ? `${head}: none to force.` : `${head}:\n${every.join('\n')}`;
}

/** Player 1's lines first, each player's engine line before the played line; a played engine move has one line. */
export function lineBlocks(lines: readonly EvalLine[], ctx: LineViewContext): LineBlockView[] {
  const order = (line: EvalLine) => (line.side === 'p1' ? 0 : 2) + (line.for.includes('engine') ? 0 : 1);
  return [...lines].sort((a, b) => order(a) - order(b)).map((line, index) => {
    const { rows, every } = stepViews(line, ctx);
    const player = ctx.playerNames[SIDE_INDEX[line.side]];
    const endPct = winPctText(line.end, line.endFainted);
    const row = ctx.rowValues?.[line.side]?.[line.for.includes('engine') ? 'engine' : 'played'] ?? null;
    const reply = replyOf(line, ctx);
    return {
      key: `${line.side}-${line.label}-${index}`, line, player, role: roleText(line, ctx.neverActed?.[line.side]),
      end: row === null ? `ends at ${endPct} for ${player}` : `row ${row}, this line ends at ${endPct}`, endPct, row, differs: row !== null && row !== endPct, reply,
      rows, tooltip: tooltipOf(every), note: unforcedNote(line), endNote: endNote(line, ctx.playerNames), worstNote: worstNote(line, reply, ctx),
    };
  });
}
