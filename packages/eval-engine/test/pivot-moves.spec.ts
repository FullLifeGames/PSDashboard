import { Dex } from '@pkmn/dex';
import { State } from '@pkmn/sim';
import type { GameRules } from '@fulllifegames/replay-core';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { isPivotMove } from '../src/pivot-moves';
import { parsePlayedActions } from '../src/played';
import { expandPivotPairs, searchOptions } from '../src/search/options';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 70 (N1): two hand lists of eight names (played.ts, search/options.ts) said which moves hand the user a switch, and
 * both held Teleport for every generation. The Dex sets `selfSwitch` on Teleport from Gen 8 on only; before that it switches
 * nobody (Gen 4 to 7 write `|-fail|`, Gen 1 to 3 write nothing). Revival Blessing carries `selfSwitch` too, but its request
 * revives a fainted ally. The reading now comes from
 * the Dex (pivot-moves.ts) and this sweep plays every move of every generation and the Champions mod against the simulator:
 * a lead with a living and a fainted bench body uses the move, and the move is a pivot when the battle then asks for a
 * switch of the living lead and accepts a living body. The root matrix and the played-action parser are held to the same
 * answers on the simulator's own logs.
 */

await loadSimMods('gen9championsou');

interface Rules { name: string; gen: number; format: string; level: number; evs?: PokemonSet['evs'] }
const RULES: Rules[] = [
  ...Array.from({ length: 9 }, (_, index) => ({ name: `Gen ${index + 1}`, gen: index + 1, format: `gen${index + 1}customgame`, level: 100 })),
  { name: 'Pokémon Champions', gen: 9, format: 'gen9championscustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 } },
];

/** The closed census: the moves the simulator lets a living lead pivot with, per generation. A new pivot fails it until listed. */
const GEN_4 = ['batonpass', 'uturn'];
const GEN_6 = [...GEN_4, 'partingshot', 'voltswitch'];
const GEN_8 = [...GEN_6, 'flipturn', 'teleport'];
const GEN_9 = [...GEN_8, 'chillyreception', 'shedtail'];
const PIVOTS: Record<string, string[]> = {
  'Gen 1': [], 'Gen 2': ['batonpass'], 'Gen 3': ['batonpass'], 'Gen 4': GEN_4, 'Gen 5': [...GEN_4, 'voltswitch'], 'Gen 6': GEN_6, 'Gen 7': GEN_6,
  'Gen 8': GEN_8, 'Gen 9': GEN_9, 'Pokémon Champions': GEN_9,
};
const EVERY_PIVOT = [...new Set(Object.values(PIVOTS).flat())].sort();

/**
 * Snorlax leads p1 with `moveId`, Blissey waits alive on its bench and Chansey has fainted (so Revival Blessing has someone to
 * revive); Chansey leads p2 and splashes. `doomed`: the lead has 1 HP and is poisoned, so it faints at the end of the turn
 * unless the move takes it off the field first, and the bench has two living bodies.
 */
function scene(rules: Rules, moveId: string, doomed = false): Battle {
  const mon = (species: string, moves: string[]): PokemonSet => set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });
  const battle = battleOf(rules.format, [mon('Snorlax', [moveId, 'splash']), mon('Blissey', ['splash']), mon('Chansey', ['splash'])], [mon('Chansey', ['splash'])]);
  const side = battle.sides[0];
  if (doomed) {
    side.active[0]!.hp = 1;
    side.active[0]!.setStatus('psn');
  } else {
    const ally = side.pokemon[2];
    ally.hp = 0;
    ally.fainted = true;
    side.pokemonLeft = 2;
  }
  return battle;
}

/** The simulator's answer: the lead stays alive, the battle asks p1 for a switch, and it accepts the living bench body. */
function simPivots(rules: Rules, moveId: string): boolean {
  const battle = scene(rules, moveId);
  battle.choose('p1', 'move 1');
  battle.choose('p2', 'move 1');
  const request = battle.sides[0].activeRequest as unknown as { forceSwitch?: boolean[] } | null;
  return !battle.sides[0].active[0]!.fainted && request?.forceSwitch?.[0] === true && battle.choose('p1', 'switch 2');
}

/**
 * Doubles: Snorlax and Blissey lead p1 with Chansey alive and Pikachu fainted behind them, the move is Snorlax's (aimed at the
 * foe in slot a when it takes a target). The answer is null when the battle refuses that choice (a move that needs another
 * target, a berry, an ally), true when slot a stays alive, is asked for a switch and takes the living bench body.
 */
function simPivotsInDoubles(rules: Rules, moveId: string): boolean | null {
  const mon = (species: string, moves: string[]): PokemonSet => set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });
  const battle = battleOf(rules.format.replace('customgame', 'doublescustomgame'),
    [mon('Snorlax', [moveId, 'splash']), mon('Blissey', ['splash']), mon('Chansey', ['splash']), mon('Pikachu', ['splash'])], [mon('Chansey', ['splash']), mon('Blissey', ['splash'])]);
  const side = battle.sides[0];
  side.pokemon[3].hp = 0;
  side.pokemon[3].fainted = true;
  side.pokemonLeft = 3;
  const aimed = ['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe'].includes(battle.dex.moves.get(moveId).target);
  if (!battle.choose('p1', aimed ? 'move 1 1, move 1' : 'move 1, move 1') || !battle.choose('p2', 'move 1, move 1')) return null;
  const request = side.activeRequest as unknown as { forceSwitch?: boolean[] } | null;
  return !side.active[0]!.fainted && request?.forceSwitch?.[0] === true && (battle.choose('p1', 'switch 3') || battle.choose('p1', 'switch 3, pass'));
}

const movesOf = (rules: Rules, battle: Battle) => battle.dex.moves.all().filter(move => move.exists && move.gen <= rules.gen && !move.isZ && !move.isMax);

describe.each(RULES)('$name: every move played against the Dex reading (round 70, N1)', rules => {
  const dex = scene(rules, 'tackle').dex;
  const moves = movesOf(rules, scene(rules, 'tackle'));

  test('the simulator\'s pivots are the Dex\'s selfSwitch moves, Teleport from Gen 8, Revival Blessing none', () => {
    expect(moves.length).toBeGreaterThan(160);
    const truth = moves.filter(move => simPivots(rules, move.id)).map(move => move.id).sort();
    expect(truth).toEqual([...PIVOTS[rules.name]].sort());
    expect(moves.filter(move => isPivotMove(dex, move.id)).map(move => move.id).sort()).toEqual(truth);
    // The main bundle reads @pkmn/dex, which strips handlers but keeps the two fields.
    expect(moves.filter(move => isPivotMove(Dex.forGen(rules.gen), move.id)).map(move => move.id).sort()).toEqual(truth);
  });

  // Gen 1 and Gen 2 have no doubles format.
  if (rules.gen >= 3) {
    test('doubles: the same moves pivot, so the reading holds for both game types', () => {
      const answers = moves.map(move => ({ id: move.id, answer: simPivotsInDoubles(rules, move.id) }));
      expect(answers.filter(entry => entry.answer).map(entry => entry.id).sort()).toEqual([...PIVOTS[rules.name]].sort());
      // A move the battle refuses at this setup is no pivot of the reading either.
      expect(answers.filter(entry => entry.answer === null && isPivotMove(dex, entry.id)).map(entry => entry.id)).toEqual([]);
    });
  }

  test('the root matrix pairs a pivot with each living bench body and nothing else', () => {
    const candidates = [...EVERY_PIVOT, 'revivalblessing', 'tackle'].filter(id => moves.some(move => move.id === id));
    for (const moveId of candidates) {
      const root = createRootPosition(JSON.stringify(State.serializeBattle(scene(rules, moveId))));
      const pairs = expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera: false })).map(option => option.choice).filter(choice => choice.includes(' > '));
      expect(`${moveId}: ${pairs.join(', ')}`).toBe(`${moveId}: ${PIVOTS[rules.name].includes(moveId) ? `move ${moveId} > switch 2` : ''}`);
    }
  });
});

/** The first turn as a spectator reads it: the simulator writes each secret line twice (`|split|`), a replay keeps the public one. */
function publicTurn(battle: Battle): string[] {
  const lines: string[] = [];
  for (let index = battle.log.indexOf('|turn|1') + 1; index < battle.log.length && !battle.log[index].startsWith('|turn|'); index++) {
    if (battle.log[index].startsWith('|split|')) index++;
    else lines.push(battle.log[index]);
  }
  return lines;
}

describe.each(RULES)('$name: the follow-up switch in the simulator\'s own log (round 70, N1)', rules => {
  const candidates = [...EVERY_PIVOT, 'revivalblessing'].filter(id => Dex.forGen(rules.gen).moves.get(id).gen <= rules.gen);

  test.each(candidates)('%s: the switch after it is its follow-up only when the move pivoted', moveId => {
    // A pivot is played by a healthy lead (Shed Tail needs half its HP); a move that does not pivot is played by the doomed lead, whose replacement follows.
    const battle = scene(rules, moveId, !PIVOTS[rules.name].includes(moveId));
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    if ((battle.sides[0].activeRequest as unknown as { forceSwitch?: boolean[] } | null)?.forceSwitch?.[0]) battle.choose('p1', 'switch 2');
    const played = parsePlayedActions(publicTurn(battle), { gen: rules.gen, mod: rules.name === 'Pokémon Champions' ? 'champions' : undefined }).p1;
    expect(played?.kind).toBe('move');
    expect(played?.pivotTarget, `${moveId}: ${publicTurn(battle).filter(line => /^\|(move|faint|switch|-fail)\|/.test(line)).join(' ')}`)
      .toBe(PIVOTS[rules.name].includes(moveId) ? 'Blissey' : undefined);
  });
});

describe('the played-action parser names no move the simulator never pivots with (round 70, N1)', () => {
  const gameOf = (rules: Rules): GameRules => ({ gen: rules.gen, mod: rules.name === 'Pokémon Champions' ? 'champions' : undefined });
  const targetAfter = (rules: Rules, name: string, between: string[]) =>
    parsePlayedActions([`|move|p1a: Snorlax|${name}|p2a: Chansey`, ...between, '|switch|p1a: Blissey|Blissey|100/100'], gameOf(rules)).p1?.pivotTarget;

  // Round 75 (T160): the parser reads the Dex of the log's generation and mod, so the census is per generation.
  describe.each(RULES)('$name', rules => {
    const every = movesOf(rules, scene(rules, 'tackle'));

    test('the switch right after a move is its follow-up for exactly the moves the generation pivots with', () => {
      expect(every.length).toBeGreaterThan(100);
      expect(every.filter(move => targetAfter(rules, move.name, []) === 'Blissey').map(move => move.id).sort()).toEqual([...PIVOTS[rules.name]].sort());
    });

    test('the switch after the body fainted is a replacement, whatever the move was', () => {
      expect(every.filter(move => targetAfter(rules, move.name, ['|faint|p1a: Snorlax']) !== undefined)).toEqual([]);
    });
  });
});
