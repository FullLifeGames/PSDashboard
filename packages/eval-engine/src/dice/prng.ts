import { PRNG, type PRNGSeed } from '@pkmn/sim';
import { answerDie, type Answered } from './answer.ts';
import { recognize } from './recognize.ts';
import { dieKey, plainKey, tieName, type Answer, type DieName, type DieResult, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import type { BattleWatch } from './watch.ts';

// Calls `inner` first on every draw, so the stream advances as it would without it.
abstract class WatchedPRNG extends PRNG {
  protected readonly inner: PRNG;
  protected readonly watch: BattleWatch;
  private shape: Draw | null = null;
  /** Draws nothing names, outside a shuffle: a turn that has any still depends on the seed. */
  unnamed = 0;

  constructor(inner: PRNG, watch: BattleWatch) {
    super(inner.getSeed(), inner.startingSeed);
    this.inner = inner;
    this.watch = watch;
  }

  protected saw?(name: DieName | null): void;

  protected abstract decide(name: DieName, draw: Draw, natural: number): number;

  override setSeed(seed: PRNGSeed): void {
    // PRNG's constructor calls this before `inner` exists
    if (this.inner) this.inner.setSeed(seed);
    else super.setSeed(seed);
  }

  override getSeed(): PRNGSeed {
    return this.inner.getSeed();
  }

  override clone(): PRNG {
    return this.inner.clone();
  }

  override random(from?: number, to?: number): number {
    const natural = this.inner.random(from, to);
    const draw: Draw = this.shape ?? { call: 'random', from, to };
    const name = recognize(draw, this.watch, this.watch.battle.gen);
    this.watch.settle();
    this.saw?.(name);
    if (!name && this.shape?.call !== 'shuffle') this.unnamed++;
    return name ? this.decide(name, draw, natural) : natural;
  }

  override randomChance(numerator: number, denominator: number): boolean {
    return this.within({ call: 'chance', from: denominator, numerator }, () => super.randomChance(numerator, denominator));
  }

  override sample<T>(items: readonly T[]): T {
    return this.within({ call: 'sample', from: items.length, items }, () => super.sample(items));
  }

  override shuffle<T>(items: T[], start = 0, end = items.length): void {
    this.within({ call: 'shuffle', from: start, to: end }, () => super.shuffle(items, start, end));
    this.shuffled?.(items, start, end);
  }

  protected shuffled?(items: unknown[], start: number, end: number): void;

  private within<T>(draw: Draw, run: () => T): T {
    if (this.shape) return run();
    this.shape = draw;
    try {
      return run();
    } finally {
      this.shape = null;
    }
  }
}

interface MoveAction { choice: 'move'; pokemon: { getSlot(): string } }

const isMoveAction = (item: unknown): item is MoveAction =>
  typeof item === 'object' && item !== null && (item as { choice?: unknown }).choice === 'move'
  && typeof (item as { pokemon?: { getSlot?: unknown } }).pokemon?.getSlot === 'function';

const moveSlots = (items: readonly unknown[], start: number, end: number): string[] =>
  items.slice(start, end).filter(isMoveAction).map(item => item.pokemon.getSlot());

function respecting(slots: readonly string[], pairs: readonly (readonly [string, string])[]): string[] {
  const left = [...slots];
  const order: string[] = [];
  while (left.length > 0) {
    const next = left.find(slot => !pairs.some(([first, second]) => second === slot && left.includes(first))) ?? left[0];
    order.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return order;
}

/** Writes down what the simulator draws for every die of the natural turn, in order, per die key. */
export class RecordingPRNG extends WatchedPRNG {
  private readonly answers = new Map<string, Answer[]>();
  readonly ties: string[][] = [];
  /** The chance of every chance die per die key: numerator over denominator of the first draw. */
  readonly chances = new Map<string, number>();
  readonly names = new Map<string, DieName>();
  readonly shapes = new Map<string, Draw>();
  /** The offer's probe lets every proc come true, so the dice that follow a proc (Effect Spore's pick) are drawn. */
  procsYes = false;

  get record(): NaturalRecord {
    return this.answers;
  }

  protected override shuffled(items: unknown[], start: number, end: number): void {
    const slots = moveSlots(items, start, end);
    if (slots.length >= 2) this.ties.push(slots);
  }

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const key = dieKey(name);
    this.names.set(key, name);
    if (!this.shapes.has(key)) this.shapes.set(key, { ...draw });
    if (draw.call === 'chance' && !this.chances.has(key)) this.chances.set(key, (draw.numerator ?? 0) / (draw.from ?? 1));
    const answer: Answer = { from: draw.from, to: draw.to, value: natural };
    const list = this.answers.get(key);
    if (list) list.push(answer);
    else this.answers.set(key, [answer]);
    return this.procsYes && draw.call === 'chance' && (name.kind === 'ability-proc' || name.kind === 'item-proc') ? 0 : natural;
  }
}

export interface DieNote {
  draws: number;
  /** No draw could produce the forced answer (an accuracy of 100 percent forced to miss). */
  noChance: boolean;
  /** The answer does not fit the die (a step the roll lacks, a result of another kind): nothing was forced. */
  unfit?: boolean;
  chance?: number;
  /** `battle.log.length` at the first draw. */
  logIndex?: number;
  /** `battle.log.length` at the next draw of any die: the lines up to it are this die's own. */
  until?: number;
  shapes: Draw[];
}

/** The real turn's dice: a forced die answers as forced, the rest as the natural turn drew, else the stream. */
export class ForcedDicePRNG extends WatchedPRNG {
  readonly notes = new Map<string, DieNote>();
  private readonly forced = new Map<string, ForcedDie>();
  private readonly ties = new Map<string, ForcedDie>();
  private readonly record: NaturalRecord;
  private readonly cursors = new Map<string, number>();
  private open: { note: DieNote; name: DieName } | null = null;

  /** Raw answers per die key, one per draw (learn.ts); null: no draw sequence gives the answer. */
  private readonly scripts: ReadonlyMap<string, readonly number[] | null>;
  /** Per status-check die: whether the body acts when the draw comes true; otherwise the answer is turned round. */
  private readonly actsOnTrue: ReadonlyMap<string, boolean>;

  constructor(input: {
    inner: PRNG; watch: BattleWatch; forced: readonly ForcedDie[]; record: NaturalRecord;
    scripts?: ReadonlyMap<string, readonly number[] | null>; actsOnTrue?: ReadonlyMap<string, boolean>;
  }) {
    super(input.inner, input.watch);
    for (const die of input.forced) (die.name.kind === 'speed-tie' ? this.ties : this.forced).set(dieKey(die.name), die);
    this.record = input.record;
    this.scripts = input.scripts ?? new Map();
    this.actsOnTrue = input.actsOnTrue ?? new Map();
  }

  // The stream shuffles first; forced pairs then reorder where both stand (Gens 8 and 9 shuffle a pair more than once).
  protected override shuffled(items: unknown[], start: number, end: number): void {
    const slots = moveSlots(items, start, end);
    if (slots.length < 2 || this.ties.size === 0) return;
    const pairs: [string, string][] = [];
    for (const [index, a] of slots.entries()) {
      for (const b of slots.slice(index + 1)) {
        const name = tieName(a, b);
        const die = this.ties.get(dieKey(name));
        if (!die) continue;
        const first = 'first' in die.result ? die.result.first : undefined;
        const note = this.noteOf(dieKey(name));
        note.shapes.push({ call: 'shuffle', from: start, to: end });
        if (note.draws++ === 0) note.logIndex = this.watch.battle.log.length;
        if (first === a || first === b) pairs.push([first, first === a ? b : a]);
        else note.unfit = true;
      }
    }
    if (pairs.length === 0) return;
    const positions = items.slice(start, end).flatMap((item, offset) => (isMoveAction(item) ? [offset] : []));
    const bySlot = new Map(positions.map(offset => [(items[start + offset] as MoveAction).pokemon.getSlot(), items[start + offset]]));
    for (const [index, slot] of respecting(slots, pairs).entries()) items[start + positions[index]] = bySlot.get(slot);
  }

  // Same effect: Gens 3 and 4 draw Effect Spore's chance, then its pick; the status line follows the second draw.
  protected override saw(name: DieName | null): void {
    const open = this.open;
    if (!open) return;
    const effectOf = (die: DieName): string => (die.effectId ?? '').split(':')[0];
    if (name && name.kind === open.name.kind && name.slot === open.name.slot && effectOf(name) === effectOf(open.name)) return;
    open.note.until ??= this.watch.battle.log.length;
    this.open = null;
  }

  private noteOf(key: string): DieNote {
    let note = this.notes.get(key);
    if (!note) this.notes.set(key, note = { draws: 0, noChance: false, shapes: [] });
    return note;
  }

  drawnKeys(): ReadonlySet<string> {
    return new Set([...this.cursors].filter(([, count]) => count > 0).map(([key]) => key));
  }

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const key = dieKey(name);
    // A later hit looks up its own die first, then the die that covers every hit.
    const forcedKey = name.hit && !this.forced.has(key) ? plainKey(name) : key;
    const forced = this.forced.get(forcedKey);
    if (forced) return this.force(forcedKey, forced, draw, natural);
    const cursor = this.cursors.get(key) ?? 0;
    this.cursors.set(key, cursor + 1);
    const answer = this.record.get(key)?.[cursor];
    return answer && answer.from === draw.from && answer.to === draw.to ? answer.value : natural;
  }

  private force(key: string, die: ForcedDie, draw: Draw, natural: number): number {
    const note = this.notes.get(key) ?? { draws: 0, noChance: false, shapes: [] };
    const answer = this.answerFor(key, die, draw, natural, note.draws);
    note.draws++;
    note.shapes.push({ ...draw });
    if (note.draws === 1) {
      note.logIndex = this.watch.battle.log.length;
      this.open = { note, name: die.name };
    }
    if (answer && 'chance' in answer && answer.chance !== undefined && note.chance === undefined) note.chance = answer.chance;
    this.notes.set(key, note);
    if (!answer) {
      note.unfit = true;
      return natural;
    }
    if ('noChance' in answer) {
      note.noChance = true;
      return natural;
    }
    return answer.value;
  }

  private answerFor(key: string, die: ForcedDie, draw: Draw, natural: number, drawn: number): Answered | null {
    const script = this.scripts.get(key);
    if (script !== undefined) return this.scripted(script, drawn, natural);
    const turned = die.name.kind === 'status-check' && this.actsOnTrue.get(key) !== true;
    const result: DieResult = turned && 'happens' in die.result ? { happens: !die.result.happens } : die.result;
    const answer = answerDie(die.name.kind, result, draw, this.watch.battle.gen);
    if (turned && answer && answer.chance !== undefined) answer.chance = 1 - answer.chance;
    return answer;
  }

  private scripted(script: readonly number[] | null, draw: number, natural: number): Answered {
    if (script === null) return { noChance: true };
    return { value: draw < script.length ? script[draw] : natural };
  }
}
