import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { loggedActions, loggedDice } from '../src/dice/logged-results';
import { secondariesIn } from '../src/dice/secondaries';
import { playClicks } from './dice-fixtures';
import { dexOfRules, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { clickedOf, moveScene, scan, witnessesWanted } from './dice-logged-sweep-support';

/**
 * Round 88 (T338, #74), lane D, step D2: the sweep of the move's own chance to move its user (`move.self.chance`). The simulator is
 * the oracle: `selfDrops` (`battle-actions.js`) draws the chance once per move, not once per target, for a move without `multihit`
 * (`move.selfDropped`), so a doubles turn of a spread move shows one gain line or none, never one per struck foe. For every Dex move
 * with a `self.chance` entry in every generation and mod the corpus plays (Gens 1 to 9, the Champions mod; singles everywhere, doubles
 * from Gen 3; a rule set whose Dex has none plays none), turns play under many seeds and write logs:
 * - the Dex census: no such move has `multihit` (the draw per hit is T337, not this step);
 * - the oracle: a log never shows more than one gain line of the user for one use, and shows one gain on both seeds' sides of the die;
 * - the reader: a log with at least one gain gives the die "yes", a log with none gives "no", whatever the number of struck foes;
 * - the forced turn on another seed repeats the log's turn (`scoreAlignment` perfect) in every pair the other seed would change.
 * A plain run plays a fixed sample of each list, `DICE_SWEEPS=full` every entry.
 */
await loadSimMods('gen9championsou');
vi.setConfig({ testTimeout: 900_000 });

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const selfChance = (move: DexMove): { chance: number; boosts?: Record<string, number> } | undefined =>
  (move as unknown as { self?: { chance?: number; boosts?: Record<string, number> } }).self?.chance === undefined
    ? undefined : (move as unknown as { self: { chance: number; boosts?: Record<string, number> } }).self;
const multihitOf = (move: DexMove): unknown => (move as unknown as { multihit?: unknown }).multihit;

/** The `|-boost|` and `|-unboost|` lines the user of the move shows in a turn's log. */
const gainsOf = (log: string[], slot: string): number => log.filter(line => /^\|-(boost|unboost)\|/.test(line) && line.split('|')[2].startsWith(slot)).length;

describe.each(SWEEP_CASES)('the move\'s own chance to move its user reads once per move: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => selfChance(move) !== undefined, false);
  const reaching = sweepMoves(rules, move => selfChance(move) !== undefined).moves;

  test('the Dex census: a move with a self chance below 100 gains stats and strikes without hit counts', () => {
    for (const move of moves) {
      expect(selfChance(move)!.chance, move.id).toBeLessThan(100);
      expect(multihitOf(move), `${move.id} has multihit: the draw per hit is T337`).toBeUndefined();
    }
  });

  test('every such move: the log shows at most one gain per use, the reader names one die of it, the forced turn repeats the log', () => {
    const rows: string[] = [];
    let witnesses = 0;
    const failures: string[] = [];
    let spreadOnce = 0;
    for (const move of reaching) {
      const scene = moveScene(rules, mode, move, {
        channels: ['misses', 'crits', 'secondaries', 'cants', 'hitCounts'], kind: 'self-effect',
        options: { clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex) },
      });
      if (!scene) continue;
      // the oracle: the natural turn on many seeds
      let fired = 0, quiet = 0;
      for (let index = 0; index < 60; index++) {
        const board = scene.board(`${index + 1},${index * 7 + 2},${index * 13 + 3},${index * 31 + 4}`);
        const start = board.log.length;
        playClicks(board, scene.clicks);
        const log = board.log.slice(start);
        const action = loggedActions(log).find(entry => entry.type === 'move' && entry.slot === 'p1a' && entry.moveId === move.id);
        const struck = action ? action.targets.filter(target => target !== 'p1a' && !action.missed.includes(target)).length : 0;
        if (struck === 0) continue;
        const gains = gainsOf(log, 'p1a');
        if (gains > 1) failures.push(`${move.id} index ${index}: ${gains} gain lines for one use (${struck} struck)`);
        const dice = loggedDice(log, scene.options).filter(die => die.name.kind === 'self-effect');
        if (dice.length !== 1) failures.push(`${move.id} index ${index}: ${dice.length} self-effect dice for ${gains} gain lines against ${struck} struck foes`);
        else if ((dice[0].result as { happens: boolean }).happens !== gains > 0) failures.push(`${move.id} index ${index}: die ${JSON.stringify(dice[0].result)} for ${gains} gain lines`);
        if (gains > 0) { fired++; if (struck > 1) spreadOnce++; } else quiet++;
      }
      // the forced turn repeats the log
      const result = scan({ ...scene, pool: 40, want: 10 }, witnessesWanted());
      witnesses += result.witnesses;
      failures.push(...result.failures.map(failure => `${move.id} ${failure}`));
      rows.push(`${move.id} fired ${fired} quiet ${quiet} witnesses ${result.witnesses}`);
    }
    summaries.push(`self-chance ${rules.name} ${mode}: ${moves.length} moves, ${reaching.length} reach a foe, ${spreadOnce} firings against two struck foes, ${witnesses} witnesses, ${failures.length} failures; ${rows.join('; ')}`);
    expect(failures).toEqual([]);
    // a rule set whose Dex has no such move plays none
    if (reaching.length > 0) expect(witnesses, 'the sweep found a seed pair the log repairs').toBeGreaterThan(0);
    // the spread move fires once for both struck foes in doubles: the row the report of T338 names
    if (mode === 'doubles' && reaching.some(move => move.target === 'allAdjacentFoes')) expect(spreadOnce, 'a doubles turn with the gain against two struck foes').toBeGreaterThan(0);
  });
});
