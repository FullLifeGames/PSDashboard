import { PRNG, type PRNGSeed } from '@pkmn/sim';
import { answerDie, type Answered } from './answer.ts';
import { recognize } from './recognize.ts';
import { dieKey, type Answer, type DieName, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
import type { BattleWatch } from './watch.ts';

/**
 * Round 82 (forced dice), decisions D4 and D5: the dice of a forced turn. Both classes stand over the battle's own PRNG
 * (`inner`: the plain PRNG, or a `LoggedRollPRNG` on a branch's first turn) and call it first on every draw, so the stream
 * advances exactly as it would without them. Then they read the draw's name from `recognize` and answer: the natural
 * value, the natural turn's value, or the forced one.
 *
 * `getSeed`, `setSeed` and `clone` go to `inner`; the simulator never sees a difference except in the numbers.
 */
abstract class WatchedPRNG extends PRNG {
  protected readonly inner: PRNG;
  protected readonly watch: BattleWatch;
  /** The high-level call in flight (chance, sample, shuffle): `PRNG` routes each through `random`. */
  private shape: Draw | null = null;

  constructor(inner: PRNG, watch: BattleWatch) {
    super(inner.getSeed(), inner.startingSeed);
    this.inner = inner;
    this.watch = watch;
  }

  /** What to return for a recognized draw; `natural` is the value the stream gave. */
  protected abstract decide(name: DieName, draw: Draw, natural: number): number;

  override setSeed(seed: PRNGSeed): void {
    // PRNG's constructor calls this before `inner` exists.
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
  }

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

/** Writes down what the simulator draws for every die of the natural turn, in order, per die key. */
export class RecordingPRNG extends WatchedPRNG {
  private readonly answers = new Map<string, Answer[]>();

  get record(): NaturalRecord {
    return this.answers;
  }

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const key = dieKey(name);
    const answer: Answer = { from: draw.from, to: draw.to, value: natural };
    const list = this.answers.get(key);
    if (list) list.push(answer);
    else this.answers.set(key, [answer]);
    return natural;
  }
}

/** What the forced turn saw of one forced die. */
export interface DieNote {
  /** How many times the simulator drew it. */
  draws: number;
  /** A draw gave no way to produce the forced answer (a 100 percent accuracy forced to miss). */
  noChance: boolean;
  /** The answer does not fit the die (a step the roll lacks, a result of another kind): nothing was forced. */
  unfit?: boolean;
  /** The chance of the first draw, numerator over denominator, when the draw was a chance. */
  chance?: number;
  /** `battle.log.length` at the first draw. */
  logIndex?: number;
  /** The shape of every draw of the die (a copy of the call's `Draw`), in order: the learner reads the next draw's shape from it. */
  shapes: Draw[];
}

/**
 * The real turn's dice. A forced die answers as the user forced it; every other recognized die answers what the natural
 * turn drew for it (the next unused answer under its key, when the call has the same shape), so a forced die that changes
 * the number of draws moves no other action's dice; every draw nothing names follows the stream.
 */
export class ForcedDicePRNG extends WatchedPRNG {
  readonly notes = new Map<string, DieNote>();
  private readonly forced = new Map<string, ForcedDie>();
  private readonly record: NaturalRecord;
  private readonly cursors = new Map<string, number>();

  /** Raw answers per die key, one per draw, learned on copies (learn.ts); null means no draw sequence gives the answer. */
  private readonly scripts: ReadonlyMap<string, readonly number[] | null>;

  constructor(input: {
    inner: PRNG; watch: BattleWatch; forced: readonly ForcedDie[]; record: NaturalRecord; scripts?: ReadonlyMap<string, readonly number[] | null>;
  }) {
    super(input.inner, input.watch);
    for (const die of input.forced) this.forced.set(dieKey(die.name), die);
    this.record = input.record;
    this.scripts = input.scripts ?? new Map();
  }

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const key = dieKey(name);
    const forced = this.forced.get(key);
    if (forced) return this.force(key, forced, draw, natural);
    const cursor = this.cursors.get(key) ?? 0;
    this.cursors.set(key, cursor + 1);
    const answer = this.record.get(key)?.[cursor];
    return answer && answer.from === draw.from && answer.to === draw.to ? answer.value : natural;
  }

  private force(key: string, die: ForcedDie, draw: Draw, natural: number): number {
    const note = this.notes.get(key) ?? { draws: 0, noChance: false, shapes: [] };
    const script = this.scripts.get(key);
    const answer = script === undefined ? answerDie(die.name.kind, die.result, draw, this.watch.battle.gen) : this.scripted(script, note.draws, natural);
    note.draws++;
    note.shapes.push({ ...draw });
    if (note.draws === 1) note.logIndex = this.watch.battle.log.length;
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

  /** The learned raw answer of a die's draw, the stream's own after the script ends, or the word that no sequence reaches the answer. */
  private scripted(script: readonly number[] | null, draw: number, natural: number): Answered {
    if (script === null) return { noChance: true };
    return { value: draw < script.length ? script[draw] : natural };
  }
}
