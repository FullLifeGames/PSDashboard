import type { WinStep } from '@fulllifegames/eval-engine';
import { activeNamesAt, lineBlocks, rankWords, type LineBlockView, type LinesHost } from './line-view';

type Side = 'p1' | 'p2';

const TURNS = 3;
const turnWords = (turns: number): string => `${turns} turn${turns === 1 ? '' : 's'}`;

export type WinStepKind = WinStep['kind'];
export interface WinStepView {
  kind: WinStepKind;
  title: string;
  headline: string | null;
  empty: string | null;
  block: LineBlockView | null;
}

export interface WinPathsViewContext {
  turn: number;
  playerNames: [string, string];
  doubles: boolean;
  host: LinesHost;
  side: Side;
  question?: 'lost' | 'proof';
  turns?: number;
  playedLabel: string | null;
  /** The loser was knocked out before it moved: `playedLabel` stands in for a choice the log does not show. */
  playedNeverActed?: boolean;
}

export { rankWords };

export function chanceText(chance: number): string {
  const percent = chance * 100;
  return `${percent < 20 ? (Math.round(percent * 10) / 10).toString() : Math.round(percent).toString()} %`;
}

const NONE = `None within ${TURNS} turns.`;
const NONE_LUCK = `None within ${TURNS} turns at 1 in 1,000 or better.`;
const noProof = (turns: number): string => `The proof did not replay within ${turnWords(turns)}.`;
const STOPPED = 'Stopped at the search limit; nothing found so far.';
const FAILED = 'This step could not run.';

function emptySentence(step: WinStep, ctx: WinPathsViewContext): string | null {
  if (step.status === 'found') return null;
  if (step.status === 'stopped') return STOPPED;
  if (step.status === 'failed') return FAILED;
  if (ctx.question === 'proof') return noProof(ctx.turns ?? TURNS);
  return step.kind === 'luck' ? NONE_LUCK : NONE;
}

const sequenceOf = (step: WinStep): string => (step.chance === undefined ? '' : `This sequence: ${chanceText(step.chance)}.`);

function mistakeHeadline(step: WinStep, opponent: string, player: string): string | null {
  const { deviation } = step;
  if (!deviation) return sequenceOf(step) || null;
  const chance = step.chance === undefined ? '' : `: this sequence has ${chanceText(step.chance)}`;
  return `If ${opponent} had played ${deviation.label} (its ${rankWords(deviation.rank)}) on turn ${deviation.turn}, ${player} wins${chance}.`;
}

const PREFIXES: Record<string, string> = { Tera: 'Terastallize', Mega: 'Mega Evolve', Ultra: 'Ultra Burst' };

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

function playedSentence(step: WinStep, ctx: WinPathsViewContext): string {
  if (step.played === undefined) return '';
  const player = ctx.playerNames[ctx.side === 'p1' ? 0 : 1];
  const chance = chanceText(step.played);
  if (ctx.playedNeverActed) {
    const body = activeNamesAt(ctx.host.snapshotAt?.(ctx.turn) ?? ctx.host.snapshot)?.[ctx.side][0] || 'The Pokémon';
    return `${body} was knocked out before it moved, so the log shows no choice; staying in wins in ${chance} of the dice.`;
  }
  if (ctx.question === 'proof' && ctx.playedLabel !== null && ctx.playedLabel === step.line?.label) return `${player} played this choice.`;
  return `What ${player} played${ctx.playedLabel ? `, ${showdownWords(ctx.playedLabel)},` : ''} wins in ${chance} of the dice.`;
}

function strongerHeadline(step: WinStep, ctx: WinPathsViewContext, opponent: string): string | null {
  const own = step.line?.label ?? 'This choice';
  const sampled = ctx.doubles ? ' (over sampled rolls)' : '';
  const wins = step.chance === undefined ? '' : `${own} wins within ${turnWords((ctx.question === 'proof' ? step.turns : undefined) ?? ctx.turns ?? TURNS)} in ${chanceText(step.chance)} of the dice whatever ${opponent} plays${sampled}.`;
  return [wins, playedSentence(step, ctx)].filter(Boolean).join(' ') || null;
}

function headlineOf(step: WinStep, ctx: WinPathsViewContext): string | null {
  if (step.status !== 'found') return null;
  const opponent = ctx.playerNames[ctx.side === 'p1' ? 1 : 0];
  if (step.kind === 'luck') return sequenceOf(step) || null;
  return step.kind === 'mistake' ? mistakeHeadline(step, opponent, ctx.playerNames[ctx.side === 'p1' ? 0 : 1]) : strongerHeadline(step, ctx, opponent);
}

const PROOF_TITLE = 'The proof\'s line';
const TITLES: Record<WinStepKind, (opponent: string) => string> = {
  stronger: () => '1 · A stronger play',
  luck: () => '2 · Luck',
  mistake: opponent => `3 · A mistake by ${opponent}`,
};

// Counts only the dice whose other result would change who faints; a chip may also show a die that changes nothing.
export const SEQUENCE_NOTE = 'A sequence\'s chance multiplies the dice whose other result would change who faints; a die that changes nothing counts as certain, and other sequences that also win are not added.';
export const sequenceNote = (views: readonly WinStepView[]): string | null =>
  views.some(view => view.kind !== 'stronger' && view.headline !== null) ? SEQUENCE_NOTE : null;

export function winStepViews(steps: readonly WinStep[], ctx: WinPathsViewContext): WinStepView[] {
  const opponent = ctx.playerNames[ctx.side === 'p1' ? 1 : 0];
  return steps.map((step): WinStepView => {
    const [block] = step.status === 'found' && step.line
      ? lineBlocks([step.line], { turn: ctx.turn, playerNames: ctx.playerNames, doubles: ctx.doubles, rules: ctx.host.rules, actives: activeNamesAt(ctx.host.snapshotAt?.(ctx.turn) ?? ctx.host.snapshot) })
      : [];
    return { kind: step.kind, title: ctx.question === 'proof' ? PROOF_TITLE : TITLES[step.kind](opponent), headline: headlineOf(step, ctx), empty: emptySentence(step, ctx), block: block ?? null };
  });
}
