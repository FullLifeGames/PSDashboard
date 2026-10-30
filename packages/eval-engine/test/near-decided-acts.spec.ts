import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { unansweredMons } from '../src/eval-function';
import { foeActsBefore } from '../src/score/unanswered';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 79 (T282): the near-decided stage weighs a click by the chance its user still acts. 573756 turn 71: SOULWIND's
 * Clefable has a sure Moonblast against the +4 Garchomp, but Garchomp moves first and its Earthquake kills Clefable 82 % of
 * the time, so "Magnezone stood one sure KO from clearing the rest" described a click that rarely happens. The order of a
 * click against the foe's kill is the move's priority first, then the effective speed (inverted under Trick Room), and an
 * exact speed tie may go to the foe. The sweep plays every Dex move with a priority other than 0 in the rule sets the corpus
 * plays against the simulator's own queue (`comparePriority` on the actions `queue.resolveAction` builds).
 */

await loadSimMods('gen9championsou');

const SLOW = { nature: 'Brave', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 0 } };
const FAST = { nature: 'Jolly', evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } };

// Round 79 (T282 sweep): every generation the near stage reads (boundaryEvent returns nothing for generations 1 and 2) and the Champions mod.
const RULES = [
  { name: 'Generation 3', singles: 'gen3customgame', doubles: 'gen3doublescustomgame' },
  { name: 'Generation 4', singles: 'gen4customgame', doubles: 'gen4doublescustomgame' },
  { name: 'Generation 5', singles: 'gen5customgame', doubles: 'gen5doublescustomgame' },
  { name: 'Generation 6', singles: 'gen6customgame', doubles: 'gen6doublescustomgame' },
  { name: 'Generation 7', singles: 'gen7customgame', doubles: 'gen7doublescustomgame' },
  { name: 'Generation 8', singles: 'gen8customgame', doubles: 'gen8doublescustomgame' },
  { name: 'Scarlet/Violet', singles: 'gen9customgame', doubles: 'gen9doublescustomgame' },
  { name: 'Pokémon Champions', singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame' },
];

describe('the near stage weighs the click by the chance its user acts (T282)', () => {
  // A sure Double-Edge kill on the foe's lead; the foe's Focus Blast (70 %) kills a 1-HP attacker when it lands, so the
  // foe has no near stage of its own (below the 0.9 floor) and the p1 stage is the only one to read. A second Tauros waits.
  const attackerSet = (): PokemonSet => set('Tauros', ['doubleedge'], { level: 50, item: 'choiceband' });
  const foeSets = (): PokemonSet[] => [
    set('Alakazam', ['focusblast'], { level: 50 }),
    set('Machamp', ['dynamicpunch'], { level: 50 }),
  ];

  function singlesScene(speed: -6 | 6): Battle {
    const battle = battleOf('gen9customgame', [attackerSet(), attackerSet()], foeSets());
    battle.sides[0].active[0]!.sethp(1);
    battle.sides[0].active[0]!.boosts.spe = speed;
    return battle;
  }

  test('singles: a slower click that the foe kills first is no near-decided; the same click going first is', () => {
    const slow = unansweredMons(singlesScene(-6));
    expect(slow.nearDecided).toBeUndefined();
    const fast = unansweredMons(singlesScene(6));
    expect(fast.nearDecided?.side).toBe('p1');
    expect(fast.nearDecided?.species).toBe('Tauros');
    expect(fast.nearDecided?.removes).toBe('Alakazam');
    expect(fast.nearDecided?.odds ?? 0).toBeGreaterThanOrEqual(0.9);
  });

  test('singles: a click with priority acts before a faster foe, the same click without it does not', () => {
    const scene = (move: string): Battle => {
      const battle = battleOf('gen9customgame',
        [set('Mamoswine', [move], { level: 50, item: 'choiceband' }), attackerSet()],
        [set('Landorus-Therian', ['focusblast'], { level: 50 }), set('Machamp', ['dynamicpunch'], { level: 50 })]);
      battle.sides[0].active[0]!.sethp(1);
      battle.sides[0].active[0]!.boosts.spe = -6;
      return battle;
    };
    const iceShard = unansweredMons(scene('iceshard')).nearDecided;
    expect(iceShard?.side).toBe('p1');
    expect(iceShard?.removes).toBe('Landorus-Therian');
    expect(unansweredMons(scene('iciclecrash')).nearDecided).toBeUndefined();
  });

  test('singles: a foe that cannot kill first leaves the click as sure as before', () => {
    const battle = battleOf('gen9customgame', [attackerSet(), attackerSet()],
      [set('Alakazam', ['splash'], { level: 50 }), set('Machamp', ['dynamicpunch'], { level: 50 })]);
    battle.sides[0].active[0]!.boosts.spe = -6;
    // Nothing of the foe's kills before the click, so the board reads decided (the near stage stands aside for it).
    const profile = unansweredMons(battle);
    expect((profile.nearDecided ?? profile.decided)?.side).toBe('p1');
  });

  test('doubles: the stage reads slot 0 as the code does, and the same order decides', () => {
    const scene = (speed: -6 | 6): Battle => {
      const battle = battleOf('gen9doublescustomgame',
        [attackerSet(), attackerSet()], foeSets());
      battle.sides[0].active[0]!.sethp(1);
      battle.sides[0].active[0]!.boosts.spe = speed;
      return battle;
    };
    expect(unansweredMons(scene(-6)).nearDecided).toBeUndefined();
    expect(unansweredMons(scene(6)).nearDecided?.side).toBe('p1');
  });
});

describe.each(RULES)('$name: who acts first, the reading against the simulator (T282)', rules => {
  const mon = (moves: string[], extra: Partial<PokemonSet>): PokemonSet => set('Snorlax', moves, { level: 100, ...extra });

  /** The simulator's queue: can the foe's action come before mine (a tie counts as possible)? */
  function simFoeFirst(battle: Battle, foeMove: string, myMove: string): boolean {
    const foe = battle.sides[1].active[0]!;
    const mine = battle.sides[0].active[0]!;
    const action = (pokemon: typeof mine, moveid: string) =>
      battle.queue.resolveAction({ choice: 'move', pokemon, moveid, targetLoc: 1 } as never).find(candidate => candidate.choice === 'move')!;
    return battle.comparePriority(action(foe, foeMove) as never, action(mine, myMove) as never) <= 0;
  }

  const dex = battleOf(rules.singles, [mon(['splash'], SLOW)], [mon(['splash'], SLOW)]).dex;
  const priorityMoves = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && !move.isMax && !move.isZ &&
    move.id !== 'struggle' && move.priority !== 0);

  test('the sweep covers the priority moves of the rule set', () => {
    expect(priorityMoves.length).toBeGreaterThan(15);
    // The moves with a priority handler of their own are not read from the Dex priority: they stay named, so a new one shows.
    const handlers = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && typeof (move as { onModifyPriority?: unknown }).onModifyPriority === 'function')
      .map(move => move.id).sort();
    expect(handlers).toEqual(dex.gen >= 8 ? ['grassyglide'] : []);
  });

  test.each([
    ['singles', rules.singles],
    ['doubles', rules.doubles],
  ])('%s: every priority move in both seats, at both speeds, at a speed tie and under Trick Room', (_label, format) => {
    const rows: string[] = [];
    // Trick Room exists from generation 4 on.
    for (const trickRoom of dex.gen >= 4 ? [false, true] : [false]) {
      for (const [mineSet, foeSet] of [[SLOW, FAST], [FAST, SLOW], [SLOW, SLOW]] as const) {
        for (const move of priorityMoves) {
          for (const seat of ['mine', 'foe'] as const) {
            const myMove = seat === 'mine' ? move.id : 'tackle';
            const foeMove = seat === 'foe' ? move.id : 'tackle';
            const doubles = format === rules.doubles;
            const battle = battleOf(format,
              [mon([myMove, 'splash'], mineSet), ...(doubles ? [mon(['splash'], SLOW)] : [])],
              [mon([foeMove, 'splash'], foeSet), ...(doubles ? [mon(['splash'], SLOW)] : [])]);
            const mine = battle.sides[0].active[0]!;
            const foe = battle.sides[1].active[0]!;
            if (trickRoom) battle.field.addPseudoWeather('trickroom', mine);
            const sim = simFoeFirst(battle, foeMove, myMove);
            const ours = foeActsBefore(battle, foe, foeMove, mine, myMove);
            if (sim !== ours) rows.push(`${move.id} ${seat} mine=${mineSet === SLOW ? 'slow' : 'fast'} foe=${foeSet === SLOW ? 'slow' : 'fast'} trickroom=${trickRoom}: sim ${sim}, ours ${ours}`);
          }
        }
      }
    }
    expect(rows).toEqual([]);
  });
});
