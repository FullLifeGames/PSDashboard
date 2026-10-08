import { describe, expect, test } from 'vitest';
import { Field, Generations, Pokemon } from '@smogon/calc';
import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { inferSpreads } from '../src/spread-inference';
import { scarfedSpeed } from '../src/spreads/race-speed';
import type { SpeedKnowledge } from '../src/spreads/scarf';
import type { SpreadCandidate } from '../src/spreads/ladder';
import type { PokemonEvs, SpeedOrderObservation } from '../src/types';
import { toId } from '../src/ids';

/**
 * Round 64 (T122): the rests of the move order. A race reads the Speed the
 * simulator plays: a Choice Scarf rounded as the simulator rounds it, a
 * battle forme on its own base Speed, a transformed mover on its target's
 * Speed with its own item. Only a race that cannot end strict may tie, and
 * a Speed IV below 31 comes in only when no other Speed keeps an order.
 */
type Side = 'p1' | 'p2';
type Sets = { p1: PokemonSet[]; p2: PokemonSet[] };
const evs = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });
const mon = (species: string, nature: string, spread: PokemonEvs, item = '', moves = ['Protect']): PokemonSet => ({
  name: species, species, item, ability: '', moves, nature, evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
});
const knowledge = (entries: Record<string, Partial<SpeedKnowledge>>): Map<string, SpeedKnowledge> =>
  new Map(Object.entries(entries).map(([key, value]) => [key, {
    itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [], ...value,
  }]));
const race = (first: Side, firstSpecies: string, second: Side, secondSpecies: string, turn: number, extra: Partial<SpeedOrderObservation> = {}): SpeedOrderObservation =>
  ({ firstSide: first, firstSpecies, secondSide: second, secondSpecies, turn, ...extra });
const spreadOf = (solved: Map<string, SpreadCandidate>, sets: Sets, side: Side, species: string) =>
  solved.get(`${side}:${toId(species)}`) ?? sets[side].find(set => toId(set.species) === toId(species))!;

/** The Speed @smogon/calc gives the built mon with its item (an independent reading of the simulator's rounding). */
function calcRaceSpeed(gen: number, species: string, spread: { nature: string; evs: PokemonEvs }, item: string): number {
  const generation = Generations.get(gen as 4 | 5 | 6 | 7 | 8 | 9);
  const pokemon = new Pokemon(generation, species, { nature: spread.nature, evs: spread.evs, item: item || undefined });
  const field = new Field();
  return getFinalSpeed(generation, pokemon, field, field.attackerSide);
}

describe('a Choice Scarf races at the Speed the simulator rounds (T122 point 3)', () => {
  test('the Scarf Speed equals @smogon/calc on every Speed a few species reach, gens 4 to 9', () => {
    for (const gen of [4, 5, 6, 7, 8, 9]) {
      for (const species of ['Heatran', 'Garchomp', 'Shuckle', 'Ninjask']) {
        for (const nature of ['Hardy', 'Timid', 'Brave']) {
          for (let spe = 0; spe <= 252; spe += 4) {
            const spread = { nature, evs: evs(0, 0, 0, 0, 0, spe) };
            const stat = new Pokemon(Generations.get(gen as 9), species, spread).stats.spe;
            expect(scarfedSpeed(gen, stat), `${gen} ${species} ${nature} ${spe}`).toBe(calcRaceSpeed(gen, species, spread, 'Choice Scarf'));
          }
        }
      }
    }
    expect([scarfedSpeed(9, 201), scarfedSpeed(9, 202)]).toEqual([301, 303]);
  });

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a strict repair under a Scarf lands on a real lead, not on 301.5 against 301 (${formatid})`, () => {
      // Scarf Heatran (190 at 0 Speed EVs, 285 with the Scarf) moved before a known Garchomp at 301.
      // 44 Speed EVs give Heatran 201 and a Scarfed 301.5 unrounded; the simulator plays 301, a coin flip.
      const sets = {
        p1: [mon('Heatran', 'Modest', evs(252, 0, 0, 252, 4, 0), 'Choice Scarf')],
        p2: [mon('Garchomp', 'Adamant', evs(0, 252, 0, 0, 12, 244), 'Rocky Helmet')],
      };
      expect(calcRaceSpeed(9, 'Garchomp', sets.p2[0], 'Rocky Helmet')).toBe(301);
      const solved = inferSpreads([], sets, formatid, [race('p1', 'Heatran', 'p2', 'Garchomp', 3)], knowledge({
        'p1:heatran': { itemKnown: true }, 'p2:garchomp': { itemKnown: true, spreadKnown: true },
      }));
      expect(calcRaceSpeed(9, 'Heatran', spreadOf(solved, sets, 'p1', 'Heatran'), 'Choice Scarf')).toBeGreaterThan(301);
    });
  }
});

/** A battle the simulator plays, with every player's choices per turn. */
function simulate(format: string, p1: PokemonSet[], p2: PokemonSet[], turns: [string, string][]): Battle {
  const battle = new Battle({
    formatid: toID(format), seed: '1,2,3,4',
    p1: { name: 'Alice', team: Teams.pack(p1) }, p2: { name: 'Bob', team: Teams.pack(p2) },
  });
  const order = (team: PokemonSet[]) => `team ${team.map((_, index) => index + 1).join('')}`;
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices(order(p1), order(p2));
  for (const [first, second] of turns) battle.makeChoices(first, second);
  return battle;
}

/** The spectator's log of a simulated battle (a replay): each split keeps its public line. */
function replayLog(battle: Battle): string {
  const lines: string[] = [];
  for (let i = 0; i < battle.log.length; i++) {
    if (battle.log[i].startsWith('|split|')) {
      lines.push(battle.log[i + 2]);
      i += 2;
    } else {
      lines.push(battle.log[i]);
    }
  }
  return lines.join('\n');
}

/** The turn's move lines, in the order the simulator played them. */
const movers = (battle: Battle, turn: number) => {
  const lines = replayLog(battle).split('\n');
  const start = lines.indexOf(`|turn|${turn}`);
  const end = lines.indexOf(`|turn|${turn + 1}`);
  return lines.slice(start, end).filter(line => line.startsWith('|move|')).map(line => line.split('|')[2]);
};
const ordersOf = (battle: Battle, turn: number) => parseReplayLogWithObservations(replayLog(battle)).speedOrders
  .filter(order => order.turn === turn).map(order => `${order.firstSide} ${order.firstSpecies} > ${order.secondSide} ${order.secondSpecies}`);

describe('a battle forme races with the Speed the simulator gave it that turn (T122 point 5)', () => {
  // Lopunny 339 (Jolly 252) is slower than Latias 350 (Timid 252); Lopunny-Mega 405 is faster.
  const lopunny = mon('Lopunny', 'Jolly', evs(0, 0, 0, 0, 0, 252), 'Lopunnite', ['Splash']);
  const latias = mon('Latias', 'Timid', evs(0, 0, 0, 0, 0, 252), 'Leftovers', ['Splash']);
  const shuckle = (name: string) => ({ ...mon('Shuckle', 'Relaxed', evs(0, 0, 0, 0, 0, 0), 'Leftovers', ['Splash']), name });

  test('singles: Gen 6 plays the evolution turn on the base forme, Gen 7 on the Mega; the order names the forme that raced', () => {
    const gen6 = simulate('gen6customgame', [lopunny], [latias], [['move 1 mega', 'move 1'], ['move 1', 'move 1']]);
    expect(movers(gen6, 1)).toEqual(['p2a: Latias', 'p1a: Lopunny']);
    expect(movers(gen6, 2)).toEqual(['p1a: Lopunny', 'p2a: Latias']);
    expect(ordersOf(gen6, 1)).toEqual(['p2 Latias > p1 Lopunny']);
    expect(ordersOf(gen6, 2)).toEqual(['p1 Lopunny-Mega > p2 Latias']);
    const gen7 = simulate('gen7customgame', [lopunny], [latias], [['move 1 mega', 'move 1']]);
    expect(movers(gen7, 1)).toEqual(['p1a: Lopunny', 'p2a: Latias']);
    expect(ordersOf(gen7, 1)).toEqual(['p1 Lopunny-Mega > p2 Latias']);
  });

  test('doubles: the same in Gen 6 and Gen 7 doubles', () => {
    const p1 = [lopunny, shuckle('Shuckle')];
    const p2 = [latias, shuckle('Shuckle')];
    const gen6 = simulate('gen6doublescustomgame', p1, p2, [['move 1 mega, move 1', 'move 1, move 1']]);
    expect(movers(gen6, 1).slice(0, 2)).toEqual(['p2a: Latias', 'p1a: Lopunny']);
    expect(ordersOf(gen6, 1)).toContain('p2 Latias > p1 Lopunny');
    expect(ordersOf(gen6, 1)).toContain('p1 Lopunny > p2 Shuckle');
    expect(ordersOf(gen6, 1).filter(order => order.includes('Mega'))).toEqual([]);
    const gen7 = simulate('gen7doublescustomgame', p1, p2, [['move 1 mega, move 1', 'move 1, move 1']]);
    expect(movers(gen7, 1).slice(0, 2)).toEqual(['p1a: Lopunny', 'p2a: Latias']);
    expect(ordersOf(gen7, 1)).toContain('p1 Lopunny-Mega > p2 Latias');
  });
});

describe('a transformed mover races on its target\'s Speed with its own item (T122 point 6)', () => {
  const copiedOf = (log: string, turn: number) => parseReplayLogWithObservations(log).speedOrders
    .filter(order => order.turn === turn)
    .map(order => `${order.firstSide} ${order.firstSpecies}${order.firstCopied ? ` as ${order.firstCopied.side} ${order.firstCopied.species}` : ''}` +
      ` > ${order.secondSide} ${order.secondSpecies}${order.secondCopied ? ` as ${order.secondCopied.side} ${order.secondCopied.species}` : ''}`);

  test('singles: an Imposter Ditto with a Choice Scarf outruns the foe\'s next Pokémon as a Scarfed Garchomp (simulator)', () => {
    // Garchomp Jolly 252 (333) copied and Scarfed: 499 against Dragapult Timid 252 (421).
    const battle = simulate('gen9customgame', [
      mon('Garchomp', 'Jolly', evs(0, 252, 0, 0, 4, 252), 'Rocky Helmet', ['Splash']),
      mon('Dragapult', 'Timid', evs(0, 0, 0, 252, 4, 252), 'Choice Specs', ['Splash']),
    ], [{ ...mon('Ditto', 'Relaxed', evs(252, 0, 252, 0, 4, 0), 'Choice Scarf', ['Transform']), ability: 'Imposter' }],
    [['switch 2', 'move 1'], ['move 1', 'move 1']]);
    expect(movers(battle, 2)).toEqual(['p2a: Ditto', 'p1a: Dragapult']);
    expect(copiedOf(replayLog(battle), 2)).toEqual(['p2 Ditto as p1 Garchomp > p1 Dragapult']);
  });

  test('doubles: Mew transformed into p1b Ogerpon-Wellspring outran p1a Landorus (2660802611 t4)', () => {
    const log = [
      '|gametype|doubles', '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', '|tier|[Gen 9] Doubles OU', '|start',
      '|switch|p1a: Lando|Landorus, M|100/100', '|switch|p1b: Oger|Ogerpon-Wellspring, F|100/100',
      '|switch|p2a: Mew|Mew|100/100', '|switch|p2b: Grimmsnarl|Grimmsnarl, M|100/100', '|turn|3',
      '|move|p1b: Oger|Ivy Cudgel|p2a: Mew', '|-damage|p2a: Mew|76/100',
      '|move|p1a: Lando|Sludge Bomb|p2b: Grimmsnarl', '|-damage|p2b: Grimmsnarl|0 fnt', '|faint|p2b: Grimmsnarl',
      '|move|p2a: Mew|Transform|p1b: Oger', '|-transform|p2a: Mew|p1b: Oger', '|upkeep',
      '|switch|p2b: Indeedee|Indeedee, M|100/100', '|turn|4',
      '|switch|p1b: Amoonguss|Amoonguss, M|100/100',
      '|move|p2a: Mew|Ivy Cudgel|p1a: Lando', '|-damage|p1a: Lando|60/100',
      '|move|p1a: Lando|Sludge Bomb|p2a: Mew', '|-damage|p2a: Mew|17/100', '|upkeep', '|turn|5',
    ].join('\n');
    expect(copiedOf(log, 4)).toEqual(['p2 Mew as p1 Ogerpon-Wellspring > p1 Landorus']);
  });

  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`the copied race binds the target's spread with the mover's Scarf, never gives the target one (${formatid})`, () => {
      // Garchomp (Adamant 0 Speed, 240) copied by a Scarf Ditto outran a known Dragapult at 421: Garchomp needs 282.
      const build = (item: string) => ({
        p1: [mon('Garchomp', 'Adamant', evs(252, 252, 0, 0, 4, 0), 'Rocky Helmet'), mon('Dragapult', 'Timid', evs(0, 0, 0, 252, 4, 252), 'Choice Specs')],
        p2: [mon('Ditto', 'Relaxed', evs(252, 0, 252, 0, 4, 0), item)],
      });
      const order = race('p2', 'Ditto', 'p1', 'Dragapult', 2, { firstCopied: { side: 'p1', species: 'Garchomp' } });
      const know = knowledge({ 'p1:garchomp': { itemKnown: true }, 'p1:dragapult': { itemKnown: true, spreadKnown: true }, 'p2:ditto': { itemKnown: true } });
      const scarfed = build('Choice Scarf');
      const solved = inferSpreads([], scarfed, formatid, [order], know);
      expect(calcRaceSpeed(9, 'Garchomp', spreadOf(solved, scarfed, 'p1', 'Garchomp'), 'Choice Scarf')).toBeGreaterThan(421);
      // Without the Scarf no Garchomp Speed reaches 421: the order binds nothing it can repair, and no item moves.
      const plain = build('Light Clay');
      const unsolved = inferSpreads([], plain, formatid, [order], know);
      expect(spreadOf(unsolved, plain, 'p1', 'Garchomp').evs.spe).toBe(0);
      expect([...unsolved.values()].some(entry => entry.item !== undefined)).toBe(false);
    });
  }
});

describe('only the races that cannot end strict may tie (T122 point 2)', () => {
  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`a forced tie leaves the component's other races strict (${formatid})`, () => {
      // The known Heatran (216) moved before Garchomp, whose slowest Speed is 216: that race can only tie.
      // Garchomp then moved before Gholdengo (prior 219), which must come strictly under 216, not onto it.
      const sets = {
        p1: [mon('Heatran', 'Modest', evs(252, 0, 0, 152, 0, 104), 'Leftovers'), mon('Gholdengo', 'Bold', evs(252, 0, 196, 0, 0, 60), 'Air Balloon')],
        p2: [mon('Garchomp', 'Jolly', evs(0, 252, 0, 0, 4, 252), 'Rocky Helmet')],
      };
      const orders = [race('p1', 'Heatran', 'p2', 'Garchomp', 3), race('p2', 'Garchomp', 'p1', 'Gholdengo', 5)];
      const solved = inferSpreads([], sets, formatid, orders, knowledge({
        'p1:heatran': { itemKnown: true, spreadKnown: true }, 'p2:garchomp': { itemKnown: true }, 'p1:gholdengo': { itemKnown: true },
      }));
      const speed = (side: Side, species: string) => calcRaceSpeed(9, species, spreadOf(solved, sets, side, species), '');
      expect([speed('p1', 'Heatran'), speed('p2', 'Garchomp')]).toEqual([216, 216]);
      expect(speed('p1', 'Gholdengo')).toBeLessThan(216);
    });
  }
});

describe('a Speed IV below 31 only when no other Speed keeps a seen order (T122 point 4, decision 28)', () => {
  for (const formatid of ['gen9ou', 'gen9doublesou']) {
    test(`the highest IV that keeps the order (${formatid})`, () => {
      // The known Ting-Lu (126) moved before Incineroar, whose slowest Speed at IV 31 is 140 (Sassy, 0 EVs).
      // IV 14 gives 125, IV 15 would tie at 126.
      const sets = {
        p1: [mon('Ting-Lu', 'Careful', evs(252, 0, 4, 0, 252, 0), 'Leftovers')],
        p2: [mon('Incineroar', 'Careful', evs(252, 0, 96, 0, 160, 0), 'Sitrus Berry')],
      };
      const orders = [race('p1', 'Ting-Lu', 'p2', 'Incineroar', 4)];
      const known = inferSpreads([], sets, formatid, orders, knowledge({
        'p1:tinglu': { itemKnown: true, spreadKnown: true }, 'p2:incineroar': { itemKnown: true },
      }));
      const incineroar = known.get('p2:incineroar');
      expect(incineroar?.ivs?.spe).toBe(14);
      expect([incineroar?.evs.spe, incineroar?.nature]).toEqual([0, 'Sassy']);
      // Control: an unknown Ting-Lu can still move, so no IV leaves 31.
      const open = inferSpreads([], sets, formatid, orders, knowledge({ 'p1:tinglu': { itemKnown: true }, 'p2:incineroar': { itemKnown: true } }));
      expect(open.get('p2:incineroar')?.ivs?.spe ?? 31).toBe(31);
    });
  }
});

describe('the forme that raced, after Ally Switch, mid-turn changes and Ultra Burst (T122 review)', () => {
  const sorted = (orders: string[]) => [...orders].sort();

  test('doubles: Ally Switch moves the slots, so a later Mega Evolution names the right Pokemon (Gen 6)', () => {
    // Meowstic (Timid 252, 307) Ally Switches into p1a at t1; at t2 Kangaskhan, now p1b, mega evolves and
    // races on its base Speed in Gen 6 (216). Meowstic Psyshocks first (a status move could ride Prankster),
    // Garchomp (333) before Kangaskhan, Shuckle last. Read with the slots before the swap, Kangaskhan's
    // evolution looked like Meowstic's and its races were named Meowstic.
    const battle = simulate('gen6doublescustomgame', [
      mon('Kangaskhan', 'Hardy', evs(0, 0, 0, 0, 0, 0), 'Kangaskhanite', ['Splash']),
      mon('Meowstic', 'Timid', evs(0, 0, 0, 0, 0, 252), 'Light Clay', ['Ally Switch', 'Psyshock']),
    ], [
      mon('Garchomp', 'Jolly', evs(0, 0, 0, 0, 0, 252), 'Leftovers', ['Splash']),
      mon('Shuckle', 'Relaxed', evs(0, 0, 0, 0, 0, 0), 'Leftovers', ['Splash']),
    ], [['move 1, move 1', 'move 1, move 1'], ['move 2 1, move 1 mega', 'move 1, move 1']]);
    expect(movers(battle, 2)).toEqual(['p1a: Meowstic', 'p2a: Garchomp', 'p1b: Kangaskhan', 'p2b: Shuckle']);
    expect(sorted(ordersOf(battle, 2))).toEqual(sorted([
      'p1 Meowstic > p2 Garchomp', 'p1 Meowstic > p2 Shuckle', 'p2 Garchomp > p1 Kangaskhan', 'p1 Kangaskhan > p2 Shuckle',
    ]));
  });
  test('singles: a second mover that changes forme after the first mover acted raced in its old forme (Gen 9, Eiscue)', () => {
    // Garchomp (Adamant 0 Speed, 240) Tackles Eiscue (136), whose Ice Face breaks into Eiscue-Noice (296)
    // before it moves; the simulator had already put Garchomp first. Read as Eiscue-Noice, the order
    // asked Garchomp for 228 Speed EVs.
    const garchomp = mon('Garchomp', 'Adamant', evs(0, 252, 0, 0, 4, 0), 'Leftovers', ['Tackle']);
    const eiscue = { ...mon('Eiscue', 'Hardy', evs(0, 0, 0, 0, 0, 0), 'Leftovers', ['Splash']), ability: 'Ice Face' };
    const battle = simulate('gen9customgame', [garchomp], [eiscue], [['move 1', 'move 1']]);
    expect(movers(battle, 1)).toEqual(['p1a: Garchomp', 'p2a: Eiscue']);
    expect(ordersOf(battle, 1)).toEqual(['p1 Garchomp > p2 Eiscue']);
    const { speedOrders } = parseReplayLogWithObservations(replayLog(battle));
    const sets = { p1: [garchomp], p2: [eiscue] };
    expect(spreadOf(inferSpreads([], sets, 'gen9ou', speedOrders), sets, 'p1', 'Garchomp').evs.spe).toBe(0);
  });

  test('doubles: each race reads the formes from the last sort before its first mover acted (Gen 9)', () => {
    // Before Garchomp (240) acts, Rotom-Wash (208) sits ahead of Eiscue (136); Garchomp's Tackle breaks
    // Eiscue into Eiscue-Noice (296) and the simulator re-sorts the movers still waiting, so Eiscue now
    // moves before Rotom-Wash: Garchomp raced Eiscue, Eiscue-Noice raced Rotom-Wash.
    const battle = simulate('gen9doublescustomgame', [
      mon('Garchomp', 'Adamant', evs(0, 252, 0, 0, 4, 0), 'Leftovers', ['Tackle']),
      mon('Rotom-Wash', 'Bold', evs(252, 0, 252, 0, 4, 0), 'Leftovers', ['Splash']),
    ], [
      { ...mon('Eiscue', 'Hardy', evs(0, 0, 0, 0, 0, 0), 'Leftovers', ['Splash']), ability: 'Ice Face' },
      mon('Shuckle', 'Relaxed', evs(0, 0, 0, 0, 0, 0), 'Leftovers', ['Splash']),
    ], [['move 1 1, move 1', 'move 1, move 1']]);
    expect(movers(battle, 1)).toEqual(['p1a: Garchomp', 'p2a: Eiscue', 'p1b: Rotom', 'p2b: Shuckle']);
    expect(sorted(ordersOf(battle, 1))).toEqual(sorted([
      'p1 Garchomp > p2 Eiscue', 'p1 Garchomp > p2 Shuckle', 'p2 Eiscue-Noice > p1 Rotom-Wash', 'p1 Rotom-Wash > p2 Shuckle',
    ]));
  });
  for (const format of ['gen7customgame', 'gen7doublescustomgame']) {
    test(`Ultra Burst re-sorts like a Mega Evolution in Gen 7, so the order names Necrozma-Ultra (${format})`, () => {
      // Necrozma-Dusk-Mane (0 Speed, 190) bursts into Necrozma-Ultra (294) and, re-sorted, moves before
      // Garchomp (240). Read on its turn-start forme, the order forced Dusk-Mane past 240.
      const necrozma = mon('Necrozma-Dusk-Mane', 'Hardy', evs(0, 252, 0, 0, 4, 0), 'Ultranecrozium Z', ['Splash']);
      const garchomp = mon('Garchomp', 'Adamant', evs(0, 252, 0, 0, 4, 0), 'Leftovers', ['Splash']);
      const doubles = format.includes('doubles');
      const battle = simulate(format,
        doubles ? [necrozma, mon('Shuckle', 'Relaxed', evs(0, 0, 0, 0, 0, 0), 'Leftovers', ['Splash'])] : [necrozma],
        doubles ? [garchomp, mon('Shuckle', 'Relaxed', evs(0, 0, 0, 0, 0, 0), 'Rocky Helmet', ['Splash'])] : [garchomp],
        [[doubles ? 'move 1 ultra, move 1' : 'move 1 ultra', doubles ? 'move 1, move 1' : 'move 1']]);
      expect(movers(battle, 1).slice(0, 2)).toEqual(['p1a: Necrozma', 'p2a: Garchomp']);
      expect(ordersOf(battle, 1)).toContain('p1 Necrozma-Ultra > p2 Garchomp');
      const { speedOrders } = parseReplayLogWithObservations(replayLog(battle));
      const sets = { p1: [necrozma], p2: [garchomp] };
      expect(spreadOf(inferSpreads([], sets, 'gen7ou', speedOrders), sets, 'p1', 'Necrozma-Dusk-Mane').evs.spe).toBe(0);
    });
  }
});
