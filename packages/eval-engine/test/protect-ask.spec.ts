import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ActiveMove, Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { bodyOf } from '../src/calc/body';
import { protectBlocks } from '../src/calc/protect';
import { shieldsFromHits, shieldsSide } from '../src/dex-facts/protect';
import { loadSimMods } from '../src/forward/sim-mods';
import { protectorStops } from '../src/search/hints';
import { copyOf, fingerprint, setAskCheck } from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T239, step 6): the last two stand-ins of the engine's Protect readers ask the simulator through the module
 * (src/sim-ask/). Each sweep plays the Dex against the simulator's own answer, with the development check on, so a
 * handler that writes the live battle fails here as `AskLeak`.
 *  - protectorStops (search/hints.ts): every protector of the Dex against one attack of every class the Dex holds (Z and Max
 *    moves, contact and not, every target and priority), the contact punishers included. The simulator's answer is the
 *    protector's own handler run on a copy of the battle with the copy's bodies and the real attack.
 *  - protectBlocks (calc/protect.ts): every ability with a ModifyMove handler against every move of the Dex, in every
 *    generation that has abilities and in the Champions mod. The simulator's answer is the protect flag the move carries
 *    after `runEvent('ModifyMove')` on the attacker.
 */

await loadSimMods('gen9championsou');

beforeAll(() => setAskCheck(true));
afterAll(() => setAskCheck(null));

interface Rules { name: string; format: string; level: number; doubles: boolean; evs?: PokemonSet['evs'] }

const CHAMPIONS_EVS = { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 };
const PROTECT_RULES: Rules[] = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', level: 100, doubles: true },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50, doubles: true, evs: CHAMPIONS_EVS },
  { name: 'Generation 4 doubles', format: 'gen4doublescustomgame', level: 100, doubles: true },
  { name: 'Generation 7 singles', format: 'gen7customgame', level: 100, doubles: false },
  { name: 'Pokémon Champions singles', format: 'gen9championscustomgame', level: 50, doubles: false, evs: CHAMPIONS_EVS },
];

const monOf = (rules: Rules, species: string, moves: string[], extra: Partial<PokemonSet> = {}) =>
  set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...extra });

/** A board whose first body of side one holds `moves`; singles or doubles by the rules. */
function boardOf(rules: Rules, moves: string[], ability = 'No Ability'): Battle {
  const mine = [monOf(rules, 'Blissey', moves, { ability })];
  const theirs = [monOf(rules, 'Shuckle', ['splash'])];
  if (rules.doubles) { mine.push(monOf(rules, 'Blissey', ['splash'])); theirs.push(monOf(rules, 'Shuckle', ['splash'])); }
  return battleOf(rules.format, mine, theirs);
}

/** One move per class of what the protectors' handlers read: flags, Z or Max power, target, category, priority. */
function attackClasses(dex: Battle['dex']): string[] {
  const seen = new Map<string, string>();
  for (const move of dex.moves.all()) {
    if (!move.exists) continue;
    const key = [Object.keys(move.flags).sort().join('+'), move.isZ ? 'Z' : '', move.isMax ? 'M' : '', move.target, move.category, move.priority].join('|');
    if (!seen.has(key)) seen.set(key, move.id);
  }
  return [...seen.values()];
}

/** What one question could leave on the bodies beyond the module's own fingerprint of the battle. */
const hitData = (...things: object[]) => things.map(thing => JSON.stringify((thing as { moveHitData?: unknown }).moveHitData ?? null));

/** The simulator's answer: the protector's own handler on a copy of the battle, with the copy's bodies and the real attack. */
function stopsOnCopy(battle: Battle, handler: unknown, attack: ActiveMove, source: Pokemon, target: Pokemon): boolean {
  const copy = copyOf(battle);
  const at = (mon: Pokemon) => copy.sides[mon.side.n].pokemon[mon.side.pokemon.indexOf(mon)];
  try {
    return (handler as (this: Battle, target: Pokemon, source: Pokemon, move: ActiveMove) => unknown).call(copy, at(target), at(source), attack) !== undefined;
  } catch {
    return false;
  }
}

describe.each(PROTECT_RULES)('$name: protectorStops asks the simulator (round 72, T239)', rules => {
  const dex = boardOf(rules, ['splash']).dex;
  const protectors = dex.moves.all().filter(move => move.exists && move.gen <= 9 && (shieldsFromHits(dex, move) || shieldsSide(dex, move))).map(move => move.id);
  const attacks = attackClasses(dex);

  test('the sweep covers the Protect family and the classes of attack', () => {
    expect(protectors.length).toBeGreaterThanOrEqual(rules.format.includes('gen4') ? 2 : 4);
    expect(attacks.length).toBeGreaterThan(40);
  });

  test.each(protectors)('%s: every class of attack gets the answer a copy of the battle gives, and the live battle stays as it was', protector => {
    const battle = boardOf(rules, [protector, 'splash']);
    const [source, target] = [battle.sides[1].active[0]!, battle.sides[0].active[0]!];
    const move = dex.moves.get(protector);
    const condition = move.sideCondition || move.volatileStatus;
    const handler = (dex.conditions.get(condition) as { onTryHit?: unknown }).onTryHit;
    expect(typeof handler, protector).toBe('function');
    const before = fingerprint(battle, hitData(source, target));
    const wrong: string[] = [];
    let stopped = 0;
    for (const attackId of attacks) {
      const read = protectorStops(battle, move, battle.dex.getActiveMove(attackId), source, target);
      if (read) stopped++;
      if (read !== stopsOnCopy(battle, handler, battle.dex.getActiveMove(attackId), source, target)) wrong.push(attackId);
    }
    expect(wrong, protector).toEqual([]);
    expect(fingerprint(battle, hitData(source, target))).toBe(before);
    // The question is not vacuous: a protector stops some class of attack.
    expect(stopped, protector).toBeGreaterThan(0);
  });
});

/** ModifyMove handlers of abilities exist from Generation 3. */
const ABILITY_RULES: Rules[] = [3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `Generation ${gen}`, format: `gen${gen}customgame`, level: 100, doubles: false }))
  .concat([{ name: 'Pokémon Champions', format: 'gen9championscustomgame', level: 50, doubles: false, evs: CHAMPIONS_EVS }]);

describe.each(ABILITY_RULES)('$name: protectBlocks reads the protect flag the simulator leaves after ModifyMove (round 72, T239)', rules => {
  test('every ability with a ModifyMove handler against every move of the Dex', () => {
    const dex = boardOf(rules, ['splash']).dex;
    const abilities = dex.abilities.all().filter(ability => ability.exists && typeof (ability as { onModifyMove?: unknown }).onModifyMove === 'function').map(ability => ability.name);
    const moves = dex.moves.all().filter(move => move.exists);
    expect(abilities.length).toBeGreaterThan(5);
    const gen = calcGenerationFor(dex.gen, dex.currentMod);
    const wrong: string[] = [];
    let flagTaken = 0;
    for (const ability of ['No Ability', ...abilities]) {
      const battle = boardOf(rules, ['splash'], ability);
      const [attacker, target] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      const body = bodyOf(battle, attacker);
      for (const move of moves) {
        const active = battle.dex.getActiveMove(move.id);
        battle.runEvent('ModifyMove', attacker, target, active, active);
        const sim = !!active.flags.protect;
        if (sim !== !!move.flags.protect) flagTaken++;
        if (protectBlocks(gen, move.name, body) !== sim) wrong.push(`${ability} ${move.id}`);
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    // The sweep sees a real case wherever the generation has one: an ability that takes the protect flag off a move (the Champions mod keeps the flag: its Unseen Fist answers in onHitProtect).
    if (dex.gen >= 8 && !rules.format.includes('champions')) expect(flagTaken).toBeGreaterThan(0);
  });
});
