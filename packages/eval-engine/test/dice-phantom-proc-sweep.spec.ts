import { describe, expect, test } from 'vitest';
import { faintStep } from '../src/dice/logged-block';
import { loadSimMods } from '../src/forward/sim-mods';
import { dieKey, type DieKind, type ForcedDie } from '../src/dice/types';
import { extractProtocolEvents } from '../src/hax-alignment';
import { CLASSES } from './dice-census-support';
import { EFFECT_SPORE, hitDie, labelOf, mentions, PROCS, present, procBoard, type Proc } from './dice-ability-support';
import { sweepSelection } from './dice-fixtures';
import { forcedOn, SWEEP_CASES, sweepClicks } from './dice-sweep-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B4b (T306): the phantom procs. An ability or an item that draws a chance when its
 * holder is hit (Cute Charm, Static, Flame Body, Poison Point, Cursed Body, Effect Spore, the attacker's Poison Touch and Toxic Chain,
 * the Focus Band) is a die the log shows only when it came true. The forced turn answers the dice the log shows and leaves the rest to
 * the hidden dice of the frozen seed, so a seed that says yes gave a body a Cute Charm infatuation, a burn or a paralysis the game never
 * showed (573756: Conscripts carried `attract` from turn 2 to 10). The faint step now forces such a die not to happen unless the log
 * shows its effect on the hit. This sweep plays every proc the census knows in every rule set the corpus plays, singles and doubles:
 * the log's turn is the turn with the proc forced to the log's answer, and the forced turn of another seed must show the same.
 */
await loadSimMods('gen9championsou');

const LOG_SEED = '31,41,59,26';
/** Seeds whose hidden dice differ from the log: the search takes the first ones that show the proc (or not) without being forced. */
const POOL = sweepSelection(Array.from({ length: 40 }, (_, index) => `${index * 3 + 1},${index * 7 + 2},${index * 11 + 5},${index * 13 + 9}`), 'pool');
const WITNESSES = 2;
const ALL: Proc[] = [...PROCS, EFFECT_SPORE];
const PROC_KINDS: ReadonlySet<DieKind> = new Set(['ability-proc', 'item-proc']);
const kindOf = (proc: Proc): 'ability-proc' | 'item-proc' => (proc.kind === 'abilities' ? 'ability-proc' : 'item-proc');
const procDie = (proc: Proc, happens: boolean): ForcedDie => ({
  name: { slot: 'p1a', moveId: proc.move, targetSlot: 'p2a', kind: kindOf(proc), effectId: proc.id }, result: { happens },
});
const isProcDie = (die: ForcedDie): boolean => PROC_KINDS.has(die.name.kind);

describe.each(SWEEP_CASES)('a proc the log does not show: $name', ({ rules, mode, name }) => {
  const procs = sweepSelection(ALL.filter(proc => present(rules, proc.kind, proc.id)), 'rows');
  const clicks = sweepClicks(mode, 'normal');

  test('the rule set has procs to play, or the Dex has none (Gen 1 has no abilities and no items)', () => {
    expect(procs.length > 0 || rules.generation === 1, `${name}`).toBe(true);
  });

  test.each(procs.map(proc => [proc.id, proc] as const))('%s: the log shows no proc, the forced turn shows none', (_id, proc) => {
    const label = labelOf(rules, proc.kind, proc.id);
    const board = (seed: string) => {
      const battle = procBoard(rules, mode, proc);
      battle.prng.setSeed(seed as never);
      return battle;
    };
    const logged = forcedOn(board(LOG_SEED), clicks, [hitDie(proc.move), procDie(proc, false)]);
    const lines = logged.battle.log.slice(logged.start);
    expect(mentions(logged.battle, logged.start, label), `${name} ${proc.id}: the log's turn shows no proc`).toBe(false);
    const expected = extractProtocolEvents(lines);
    // seeds whose hidden dice say yes to the proc: the plain turn (only the hit forced) shows the effect
    const shows = (seed: string): boolean => {
      const turn = forcedOn(board(seed), clicks, [hitDie(proc.move)]);
      return mentions(turn.battle, turn.start, label);
    };
    const witnesses: string[] = [];
    for (const seed of POOL) {
      if (witnesses.length >= WITNESSES) break;
      if (shows(seed)) witnesses.push(seed);
    }
    expect(witnesses.length, `${name} ${proc.id}: a seed whose hidden dice give the proc`).toBeGreaterThan(0);
    for (const seed of witnesses) {
      const result = faintStep({ battle: board(seed), expected, seed: seed as never, choices: clicks, lines }, [hitDie(proc.move)]);
      expect(result.dice, `${name} ${proc.id} seed ${seed}: a list`).not.toBeNull();
      const quiet = result.dice!.filter(isProcDie);
      expect(quiet.map(die => dieKey(die.name)), `${name} ${proc.id} seed ${seed}: the proc die is forced`).toContain(dieKey(procDie(proc, false).name));
      expect(quiet.every(die => 'happens' in die.result && !die.result.happens), `${name} ${proc.id}: only to not happen`).toBe(true);
      const replay = forcedOn(board(seed), clicks, result.dice!);
      expect(mentions(replay.battle, replay.start, label), `${name} ${proc.id} seed ${seed}: the forced turn shows no ${label}`).toBe(false);
    }
  });
});

describe.each(SWEEP_CASES)('a proc the log shows: $name', ({ rules, mode, name }) => {
  const procs = sweepSelection(ALL.filter(proc => present(rules, proc.kind, proc.id)), 'rows');
  const clicks = sweepClicks(mode, 'normal');

  test('the rule set has procs to play, or the Dex has none (Gen 1 has no abilities and no items)', () => {
    expect(procs.length > 0 || rules.generation === 1, `${name}`).toBe(true);
  });

  test.each(procs.map(proc => [proc.id, proc] as const))('%s: the log shows the proc, no die is forced quiet', (_id, proc) => {
    const label = labelOf(rules, proc.kind, proc.id);
    const board = (seed: string) => {
      const battle = procBoard(rules, mode, proc);
      battle.prng.setSeed(seed as never);
      return battle;
    };
    // the log's turn: a seed whose dice give the proc on the forced hit (Effect Spore of Gens 3 and 4 also picks its status, so the proc is not forced)
    const shownBy = POOL.find(seed => {
      const turn = forcedOn(board(seed), clicks, [hitDie(proc.move)]);
      return mentions(turn.battle, turn.start, label);
    });
    expect(shownBy, `${name} ${proc.id}: a seed whose dice show the proc`).toBeTruthy();
    const logged = forcedOn(board(shownBy!), clicks, [hitDie(proc.move)]);
    const lines = logged.battle.log.slice(logged.start);
    const expected = extractProtocolEvents(lines);
    for (const seed of POOL.slice(0, 4)) {
      const result = faintStep({ battle: board(seed), expected, seed: seed as never, choices: clicks, lines }, [hitDie(proc.move)]);
      // a seed whose hidden dice leave the log's Focus Band out ends the game early: the seed search takes that block (ruling Q2), nothing is forced
      if (result.dice === null) continue;
      expect(result.dice.filter(isProcDie), `${name} ${proc.id} seed ${seed}: the log's proc is not forced away`).toEqual([]);
    }
  });
});

describe('the census holds the sweep', () => {
  test('every ability and item proc the census finds is a proc the phantom sweep plays', () => {
    const ids = ALL.map(proc => proc.id);
    const rows = Object.entries(CLASSES).filter(([, entry]) => entry.kind === 'ability-proc' || entry.kind === 'item-proc');
    expect(rows.length).toBeGreaterThan(0);
    for (const [key] of rows) expect(ids, key).toContain(key.split('/')[1]);
  });
});
