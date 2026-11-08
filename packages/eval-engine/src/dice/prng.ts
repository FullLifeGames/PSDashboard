import { PRNG, type PRNGSeed } from '@pkmn/sim';
import { answerDie, type Answered } from './answer.ts';
import { recognize } from './recognize.ts';
import { dieKey, plainKey, tieName, type Answer, type DieName, type DieResult, type Draw, type ForcedDie, type NaturalRecord } from './types.ts';
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

  /** A draw is about to be answered; `name` is its die, or null when nothing names it. */
  protected saw?(name: DieName | null): void;

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
    this.saw?.(name);
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

  /** The segment of `items` between `start` and `end` was just shuffled. A speed tie among move actions ends here. */
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

/** A queue action of a body's move: the items a speed tie shuffles when two moves tie (the other shuffles hold handlers). */
const isMoveAction = (item: unknown): item is MoveAction =>
  typeof item === 'object' && item !== null && (item as { choice?: unknown }).choice === 'move'
  && typeof (item as { pokemon?: { getSlot?: unknown } }).pokemon?.getSlot === 'function';

/** The slots of the move actions in a segment of a shuffled list, in their order. */
const moveSlots = (items: readonly unknown[], start: number, end: number): string[] =>
  items.slice(start, end).filter(isMoveAction).map(item => item.pokemon.getSlot());

/**
 * The order of `slots` that keeps their current order as far as the pairs allow and puts the first of each pair ahead of the
 * second: the next slot is the earliest one that no pair still holds back.
 */
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
  /** The slots of the move actions of every shuffle that held two or more of them (a speed tie), in order. */
  readonly ties: string[][] = [];
  /** The chance of every chance die drawn, per die key (numerator over denominator of the first draw). */
  readonly chances = new Map<string, number>();
  /** The name of every die drawn, per die key. */
  readonly names = new Map<string, DieName>();
  /** The shape of the first draw of every die, per die key (a sample's items tell the results of the die). */
  readonly shapes = new Map<string, Draw>();
  /** The offer's probe lets every proc chance come true, so the dice that follow a proc (Effect Spore's pick) are drawn and can be listed. */
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
  /** `battle.log.length` at the next draw of any die after the first: the lines up to here are this die's own (a proc, an end-of-turn die). */
  until?: number;
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
  /** The forced speed ties, by pair key. */
  private readonly ties = new Map<string, ForcedDie>();
  private readonly record: NaturalRecord;
  private readonly cursors = new Map<string, number>();
  /** The die whose first draw was the last forced one: the next draw of any kind closes its window. */
  private open: { note: DieNote; name: DieName } | null = null;

  /** Raw answers per die key, one per draw, learned on copies (learn.ts); null means no draw sequence gives the answer. */
  private readonly scripts: ReadonlyMap<string, readonly number[] | null>;
  /**
   * Per status-check die: whether the body acts when the draw comes true (status-probe.ts). The user's answer says what the
   * body does, so a check whose true stops the body (or one the probe could not read) answers with the draw turned round.
   */
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

  /**
   * A shuffle that holds move actions is a speed tie: the stream shuffled it as it would without the module, and the forced
   * pairs now put their first body ahead of the second wherever both stand in the segment (Gens 8 and 9 shuffle a pair more
   * than once in a turn, so every shuffle that holds both is held to the order).
   */
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

  /**
   * The next draw ends the window of the die forced last unless it belongs to the same effect (Gens 3 and 4 draw Effect Spore's
   * chance and then its pick: the status line follows the second draw).
   */
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

  protected override decide(name: DieName, draw: Draw, natural: number): number {
    const key = dieKey(name);
    // Round 88 (T337): a later hit looks up its own die first, then the die that covers every hit, and notes under the key it used
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

  /** The answer to a forced die's draw: the learned script, or the answer of the die's kind (a status check's turned round when its draw's true stops the body). */
  private answerFor(key: string, die: ForcedDie, draw: Draw, natural: number, drawn: number): Answered | null {
    const script = this.scripts.get(key);
    if (script !== undefined) return this.scripted(script, drawn, natural);
    // a status check: the answer is what the body does, the draw's true stops it unless the probe read otherwise
    const turned = die.name.kind === 'status-check' && this.actsOnTrue.get(key) !== true;
    const result: DieResult = turned && 'happens' in die.result ? { happens: !die.result.happens } : die.result;
    const answer = answerDie(die.name.kind, result, draw, this.watch.battle.gen);
    if (turned && answer && answer.chance !== undefined) answer.chance = 1 - answer.chance;
    return answer;
  }

  /** The learned raw answer of a die's draw, the stream's own after the script ends, or the word that no sequence reaches the answer. */
  private scripted(script: readonly number[] | null, draw: number, natural: number): Answered {
    if (script === null) return { noChance: true };
    return { value: draw < script.length ? script[draw] : natural };
  }
}
