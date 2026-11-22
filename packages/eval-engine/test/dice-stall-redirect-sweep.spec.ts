import { describe, expect, test, vi } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { loggedOptions } from '../src/dice/turn';
import { loggedDice } from '../src/dice/logged-results';
import { mon, playClicks, sweepSelection } from './dice-fixtures';
import { sweepClicks, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#104), step G4b: a stalling move the body did not click. VGC 2630452654 turn 4: Calyrex clicked Astral Barrage, Iron
 * Valiant's faster Encore made it repeat Protect, and the second Protect failed (`|-fail|`). The reader named the stalling die only
 * for the move the body clicked (round 86, T306), so the forced rebuild let that Protect succeed, left a stall counter of 9 on the
 * body and priced every later "+ Protect" of the game on it ("Protect: fails (89%)" at turn 5, where the game's Protect was sure).
 *
 * The simulator is the oracle: for every stalling move of every generation and mod the corpus plays (singles everywhere, doubles from
 * Gen 3) the move is used once, then the log of its second use is read twice, once with the click on the move and once with the click
 * on another move of the body (the Encore case: the log shows the move, the click was Splash). The dice the reader names must be the
 * same, and a second use that failed must be among them (a failure the sweep never saw would prove nothing).
 */
await loadSimMods('gen9championsou');
vi.setConfig({ testTimeout: 900_000 });

const stalling = (move: DexMove): boolean => !!(move as unknown as { stallingMove?: boolean }).stallingMove;
const SEEDS = ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24'];

/** The lines of the turn the last clicks played: between the two `|turn|` lines. */
const lastTurnLines = (log: string[]): string[] => {
  const turns = log.flatMap((line, index) => (line.startsWith('|turn|') ? [index] : []));
  return log.slice(turns[turns.length - 2] + 1, turns[turns.length - 1]);
};

describe.each(SWEEP_CASES)('a stalling move the log shows and the body did not click: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, stalling, false);
  const run = (move: DexMove, seed: string) => {
    const first = sweepClicks(mode, move.target);
    const attacker = mon(rules, { species: 'Snorlax', moves: [move.id, 'splash'], gender: 'M' });
    const vaporeon = mon(rules, { species: 'Vaporeon', moves: ['splash'] });
    const battle = mode === 'singles'
      ? battleOf(rules.singles, [attacker], [vaporeon], seed)
      : battleOf(rules.doubles!, [attacker, mon(rules, { species: 'Blissey', moves: ['splash'] })], [vaporeon, mon(rules, { species: 'Vaporeon', moves: ['splash'] })], seed);
    playClicks(battle, first);
    // the click on another move of the body: Splash, the second move (the aim of the first fragment goes with it)
    const other = { p1: first.p1.replace(/^move 1( 1)?/, 'move 2'), p2: first.p2 };
    const asClicked = loggedOptions(battle, first);
    const asRedirected = loggedOptions(battle, other);
    playClicks(battle, first);
    const lines = lastTurnLines(battle.log);
    const stall = (options: ReturnType<typeof loggedOptions>) => loggedDice(lines, options).filter(die => die.name.kind === 'stalling');
    return { named: asClicked.stalling.get('p1a'), clicked: stall(asClicked), redirected: stall(asRedirected) };
  };

  test('the reader names the same stalling die whether the click was the move or another one, and a failed second use is among them', () => {
    const failures: string[] = [];
    let failedUses = 0;
    for (const move of moves) {
      for (const seed of sweepSelection(SEEDS, 'seeds')) {
        const { named, clicked, redirected } = run(move, seed);
        // the simulator draws nothing for this second use (no condition offered): nothing to compare
        if (!named) continue;
        if (clicked.some(die => 'happens' in die.result && !die.result.happens)) failedUses++;
        if (JSON.stringify(redirected) !== JSON.stringify(clicked)) failures.push(`${move.id} ${seed}: clicked ${JSON.stringify(clicked)} / redirected ${JSON.stringify(redirected)}`);
      }
    }
    expect(failures).toEqual([]);
    if (moves.length > 0 && rules.generation >= 3) expect(failedUses, 'the sweep saw a second use that failed').toBeGreaterThan(0);
  });
});
