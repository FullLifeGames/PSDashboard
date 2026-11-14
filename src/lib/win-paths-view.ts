import type { WinStep } from '@fulllifegames/eval-engine';
import { activeNamesAt, lineBlocks, type LineBlockView, type LinesHost } from './line-view';

/**
 * Round 89 (#130, G8b): what the win-path panel shows, as plain data, in the words the user ruled on 14.11.2026 (W1a to W5a): a
 * stronger play with its chance whatever the opponent answers, the likeliest lucky dice with their chance, the smallest mistake by
 * the opponent, and one sentence for a step without a find. The lines are the engine's `EvalLine`s of the job, drawn by `lineBlocks`
 * (the rows, the dice chips and the tooltip of ▶ Play, one rule in one module).
 */

type Side = 'p1' | 'p2';

/** The turns a path may take: the request's default, which the panel's sentences name. */
const TURNS = 3;

export type WinStepKind = WinStep['kind'];
export interface WinStepView {
  kind: WinStepKind;
  /** "1 · A stronger play". */
  title: string;
  /** What the step found, in one sentence; null for a step without a find. */
  headline: string | null;
  /** The sentence of a step without a find: none, stopped or failed. */
  empty: string | null;
  /** The line, drawn as the Lines section draws one; null without a find. */
  block: LineBlockView | null;
}

export interface WinPathsViewContext {
  /** The turn the search started from: the line's first step plays it. */
  turn: number;
  playerNames: [string, string];
  doubles: boolean;
  host: LinesHost;
  /** The loser: the side the search is for. */
  side: Side;
  /** The label of the choice the loser played at the turn, when the log shows it. */
  playedLabel: string | null;
  /** The loser was knocked out before it moved: `playedLabel` stands in for a choice the log does not show. */
  playedNeverActed?: boolean;
}

const ORDINALS: Record<number, string> = { 2: '2nd', 3: '3rd' };
export const ordinal = (rank: number): string => ORDINALS[rank] ?? `${rank}th`;

/** A chance as the panel prints it: one decimal under 20 %, whole percent above ("52 %", "10.8 %"). */
export function chanceText(chance: number): string {
  const percent = chance * 100;
  return `${percent < 20 ? (Math.round(percent * 10) / 10).toString() : Math.round(percent).toString()} %`;
}

const NONE = `None within ${TURNS} turns.`;
const NONE_LUCK = `None within ${TURNS} turns at 1 in 1,000 or better.`;
const STOPPED = 'Stopped at the search limit; nothing found so far.';
const FAILED = 'This step could not run.';

function emptySentence(step: WinStep): string | null {
  if (step.status === 'found') return null;
  if (step.status === 'stopped') return STOPPED;
  if (step.status === 'failed') return FAILED;
  return step.kind === 'luck' ? NONE_LUCK : NONE;
}

const sequenceOf = (step: WinStep): string => (step.chance === undefined ? '' : `This sequence: ${chanceText(step.chance)}.`);

function mistakeHeadline(step: WinStep, opponent: string): string | null {
  const { deviation } = step;
  const slip = deviation ? `If ${opponent} had played ${deviation.label} (its ${ordinal(deviation.rank)} choice) on turn ${deviation.turn}.` : '';
  return [slip, sequenceOf(step)].filter(Boolean).join(' ') || null;
}

const PREFIXES: Record<string, string> = { Tera: 'Terastallize', Mega: 'Mega Evolve', Ultra: 'Ultra Burst' };

/** An engine label ("Tera + Heat Wave→Ursaluna", "→ Corviknight") in the words of the game's own buttons and log. */
export function showdownWords(label: string): string {
  const words = (part: string): string => {
    const switched = /^→ (.+)$/.exec(part);
    return switched ? `a switch to ${switched[1]}` : part.replace('→', ' on ');
  };
  const parts = label.split(' + ');
  const out: string[] = [];
  for (let at = 0; at < parts.length; at += 1) {
    const prefix = PREFIXES[parts[at]];
    if (prefix && at + 1 < parts.length) {
      out.push(`${prefix} and ${words(parts[at + 1])}`);
      at += 1;
    } else out.push(words(parts[at]));
  }
  return out.join(' + ');
}

/** The sentence beside step 1's number: what the loser's own choice wins in, or that the log shows none. */
function playedSentence(step: WinStep, ctx: WinPathsViewContext): string {
  if (step.played === undefined) return '';
  const loser = ctx.playerNames[ctx.side === 'p1' ? 0 : 1];
  const chance = chanceText(step.played);
  if (ctx.playedNeverActed) {
    const body = activeNamesAt(ctx.host.snapshotAt?.(ctx.turn) ?? ctx.host.snapshot)?.[ctx.side][0] || 'The Pokémon';
    return `${body} was knocked out before it moved, so the log shows no choice; staying in wins in ${chance} of the dice.`;
  }
  return `What ${loser} played${ctx.playedLabel ? `, ${showdownWords(ctx.playedLabel)},` : ''} wins in ${chance} of the dice.`;
}

function strongerHeadline(step: WinStep, ctx: WinPathsViewContext, opponent: string): string | null {
  const own = step.line?.label ?? 'This choice';
  const sampled = ctx.doubles ? ' (over sampled rolls)' : '';
  const wins = step.chance === undefined ? '' : `${own} wins within ${TURNS} turns in ${chanceText(step.chance)} of the dice whatever ${opponent} plays${sampled}.`;
  return [wins, playedSentence(step, ctx)].filter(Boolean).join(' ') || null;
}

function headlineOf(step: WinStep, ctx: WinPathsViewContext): string | null {
  if (step.status !== 'found') return null;
  const opponent = ctx.playerNames[ctx.side === 'p1' ? 1 : 0];
  if (step.kind === 'luck') return sequenceOf(step) || null;
  return step.kind === 'mistake' ? mistakeHeadline(step, opponent) : strongerHeadline(step, ctx, opponent);
}

const TITLES: Record<WinStepKind, (opponent: string) => string> = {
  stronger: () => '1 · A stronger play',
  luck: () => '2 · Luck',
  mistake: opponent => `3 · A mistake by ${opponent}`,
};

/** The views of the steps that arrived, in the order of the job. */
export function winStepViews(steps: readonly WinStep[], ctx: WinPathsViewContext): WinStepView[] {
  const opponent = ctx.playerNames[ctx.side === 'p1' ? 1 : 0];
  return steps.map((step): WinStepView => {
    const [block] = step.status === 'found' && step.line
      ? lineBlocks([step.line], { turn: ctx.turn, playerNames: ctx.playerNames, doubles: ctx.doubles, rules: ctx.host.rules, actives: activeNamesAt(ctx.host.snapshotAt?.(ctx.turn) ?? ctx.host.snapshot) })
      : [];
    return { kind: step.kind, title: TITLES[step.kind](opponent), headline: headlineOf(step, ctx), empty: emptySentence(step), block: block ?? null };
  });
}
