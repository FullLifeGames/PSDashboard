import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import { createRootPosition } from '../src/forward-model';
import { createLocalTreeExecutor } from '../src/tree-orchestrator';
import { searchOptions } from '../src/search/options';
import type { EvalLine } from '../src/types';
import { branchOf } from './branch-dice-support';
import { set } from './move-oracle';

/**
 * Round 89 (#104), step G4d: a line ends where the tree stopped, and the tester's VGC 2630452654 turn 5 line ended at the player's
 * own U-turn: the position after the step asks that player who to send in, and the tree made no choice for it. The line carries
 * `awaits` (who is asked) so the panel can say why it ends there. A line that ended for another reason (a faint with nobody left, a
 * tree that went no deeper than a turn that settles) has none; a replacement the tree did make is a step of the line.
 * Singles and doubles.
 */
const mon = (species: string, moves: string[]) => set(species, moves, { level: 50 });

async function lineOf(format: string, p1: ReturnType<typeof mon>[], p2: ReturnType<typeof mon>[], pick: (labels: string[]) => { p1: string; p2: string }): Promise<EvalLine> {
  const runtime = await branchOf(format, p1, p2, '1,2,3,4');
  const serialized = JSON.stringify(State.serializeBattle(runtime.battleStream.battle!));
  const root = createRootPosition(serialized, 'standard');
  const labels = (side: 'p1' | 'p2') => searchOptions(root, side, { tera: false }).map(option => option.label);
  const step = pick([...labels('p1'), '|', ...labels('p2')]);
  const [line] = await createLocalTreeExecutor(serialized).lines!({
    requests: [{ side: 'p1', label: step.p1, for: ['engine'], donors: [[{ ...step, visits: 20 }]], visits: 20 }],
    tera: false,
  });
  return line;
}

const split = (labels: string[]) => ({ own: labels.slice(0, labels.indexOf('|')), other: labels.slice(labels.indexOf('|') + 1) });

describe('a line that ends on a switch nobody chose', () => {
  test('singles: the U-turn user is asked who to send in', async () => {
    const line = await lineOf('gen9customgame',
      [mon('Rillaboom', ['U-turn', 'Grassy Glide']), mon('Mew', ['Psychic'])], [mon('Snorlax', ['Body Slam', 'Rest']), mon('Eevee', ['Tackle'])],
      labels => { const { own, other } = split(labels); return { p1: own.find(l => l.includes('U-turn'))!, p2: other.find(l => l.includes('Body Slam'))! }; });
    expect(line.steps).toHaveLength(1);
    expect(line.awaits).toBe('p1');
  });

  test('doubles: the same, and a line that settles asks nobody', async () => {
    const p1 = [mon('Incineroar', ['U-turn', 'Fake Out']), mon('Rillaboom', ['Grassy Glide', 'Wood Hammer']), mon('Amoonguss', ['Spore']), mon('Urshifu', ['Close Combat'])];
    const p2 = [mon('Urshifu', ['Close Combat', 'Sucker Punch']), mon('Amoonguss', ['Spore', 'Rage Powder']), mon('Rillaboom', ['Grassy Glide']), mon('Incineroar', ['Fake Out'])];
    const pivot = await lineOf('gen9doublescustomgame', p1, p2, labels => {
      const { own, other } = split(labels);
      return { p1: own.find(l => l.startsWith('U-turn'))!, p2: other.find(l => l.startsWith('Close Combat'))! };
    });
    expect(pivot.awaits).toBe('p1');
    const quiet = await lineOf('gen9doublescustomgame', p1, p2, labels => {
      const { own, other } = split(labels);
      return { p1: own.find(l => !l.includes('U-turn') && !/→ /.test(l))!, p2: other.find(l => l.startsWith('Close Combat'))! };
    });
    expect(quiet.awaits).toBeUndefined();
  });
});
