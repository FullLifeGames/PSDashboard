import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { correctActivesFromProtocol } from '../src/branch/corrections';
import { takeBodyOut } from '../src/branch/team-order';
import type { SimPokemon } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { mon, RULES, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 86 (the engine reads the dice), lane B, step B9 (T306, ruling C3): the sweep of the fainted body. The reconstruction's snapshot
 * correction used to write `fainted` and hp 0 on a body the log faints and the simulator's turn left standing, and nothing else: an
 * ability that ends with its holder (Neutralizing Gas above all) never ended, so the bodies it held back never started (VGC 2159578969
 * turn 5: Slow Start never ran on Regigigas). `takeBodyOut` takes the body out the way the simulator does (`Battle#resolveFaints`: the
 * fallen count, the End events of the ability and the item, then the flags).
 *
 * The sweep plays every ability of the Dex that has an End handler, in every rule set the corpus plays (Gens 3 to 9, where abilities exist, and the
 * Champions mod; singles and doubles): the holder faints once through the simulator and once through `takeBodyOut` on identical boards, and every
 * other body, both sides, the field and the fallen counts must read the same. The scene Neutralizing Gas is one row of it, and a control row proves
 * the comparison sees what the End event does (the body left without it differs from the simulator's).
 */

await loadSimMods('gen9championsou');

const RULE_SETS: Rules[] = RULES.filter(rules => rules.generation >= 3);

/** The abilities of a rule set's Dex that carry an End handler: the ones whose end may change something. */
function endingAbilities(rules: Rules): string[] {
  const dex = dexOfRules(rules);
  return dex.abilities.all()
    .filter(ability => ability.exists && ability.gen <= dex.gen && (ability.isNonstandard === null || ability.isNonstandard === undefined || ability.isNonstandard === 'Past')
      && typeof (ability as { onEnd?: unknown }).onEnd === 'function')
    .map(ability => ability.name);
}

/** The witness: the species whose ability Neutralizing Gas holds back (Slow Start), else a body with a plain ability (Truant). */
function witnessOf(rules: Rules): { species: string; ability: string } {
  return dexOfRules(rules).species.get('regigigas').exists ? { species: 'Regigigas', ability: 'Slow Start' } : { species: 'Slaking', ability: 'Truant' };
}

/** The bench body of the entry rows: Intimidate starts on entry, so a Start event that runs twice or too early shows in the foe's Attack. */
const intimidator = (rules: Rules) => set('Gyarados', ['splash'], { level: rules.level, ability: 'Intimidate', ...(rules.evs ? { evs: rules.evs } : {}) });

/** A board past team preview: the holder leads p1 with the ability, witnesses beside and across, one benched body each so no win ends the scene. */
function board(rules: Rules, mode: Mode, ability: string, entering?: PokemonSet): Battle {
  const witness = () => set(witnessOf(rules).species, ['splash'], { level: rules.level, ability: witnessOf(rules).ability, ...(rules.evs ? { evs: rules.evs } : {}) });
  const bench = () => entering ?? mon(rules, { species: 'Blissey', moves: ['splash'] });
  const holder = set('Snorlax', ['splash'], { level: rules.level, ability, ...(rules.evs ? { evs: rules.evs } : {}), gender: 'M' });
  const p1 = mode === 'singles' ? [holder, bench()] : [holder, witness(), bench()];
  const p2 = mode === 'singles' ? [witness(), mon(rules, { species: 'Blissey', moves: ['splash'] })] : [witness(), mon(rules, { species: 'Chansey', moves: ['splash'] }), mon(rules, { species: 'Blissey', moves: ['splash'] })];
  return battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, p2);
}

const SKIP = new Set(['target', 'source', 'battle', 'side', 'pokemon', 'sourceEffect', 'effect', 'sourceSlot']);
/** A JSON-safe copy of effect state: the references back to bodies and the battle drop out, everything else stays. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null, (key, entry) => (SKIP.has(key) ? undefined : entry)));

function bodyState(body: Pokemon): unknown {
  return {
    name: body.name, hp: body.hp, status: body.status, item: body.item, ability: body.ability, boosts: body.boosts,
    abilityState: plain(body.abilityState), itemState: plain(body.itemState), volatiles: plain(body.volatiles), types: body.getTypes(),
    moves: body.moveSlots.map(slot => [slot.id, slot.pp, slot.disabled]),
  };
}

/** Everything the End event of a body can change besides the body: the other bodies, the sides' counters and conditions, the field. */
function worldState(battle: Battle, removed: Pokemon): unknown {
  return {
    bodies: battle.sides.flatMap(side => side.pokemon).filter(body => body !== removed).map(bodyState),
    sides: battle.sides.map(side => ({ left: side.pokemonLeft, fallen: side.totalFainted, conditions: plain(side.sideConditions), slots: plain(side.slotConditions) })),
    field: { weather: battle.field.weather, weatherState: plain(battle.field.weatherState), terrain: battle.field.terrain, terrainState: plain(battle.field.terrainState), pseudo: plain(battle.field.pseudoWeather) },
    removed: { hp: removed.hp, fainted: removed.fainted || removed.faintQueued },
  };
}

/** The simulator's own faint of the holder. */
function faintedBySimulator(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = board(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  holder.faint();
  battle.resolveFaints();
  return worldState(battle, holder);
}

/** The reconstruction's way: the same body through `takeBodyOut`. */
function takenOut(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = board(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  takeBodyOut(holder as unknown as SimPokemon, { fallen: true });
  return worldState(battle, holder);
}

/** The body as the old correction left it: flags only, no End event. */
function flagged(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = board(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  holder.hp = 0;
  holder.fainted = true;
  holder.faintQueued = true;
  holder.side.pokemonLeft--;
  holder.side.totalFainted++;
  return worldState(battle, holder);
}

/** The turn both sides splash, so the board stands at a boundary (turn 2) and the simulator's block holds no switch line. */
function atBoundary(rules: Rules, mode: Mode, ability: string): Battle {
  const battle = board(rules, mode, ability, intimidator(rules));
  const clicks = mode === 'singles' ? 'move 1' : 'move 1, move 1';
  battle.choose('p1', clicks);
  battle.choose('p2', clicks);
  return battle;
}

const protocolBody = (battle: Battle) => battle.sides[0].pokemon.find(body => body.species.name === 'Gyarados')!;

/** Round 86 (B10): the simulator's own replacement: the holder faints and its End events run, then the bench body switches in. */
function replacedBySimulator(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = atBoundary(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  holder.faint();
  battle.resolveFaints();
  battle.actions.switchIn(protocolBody(battle), 0);
  while (battle.queue.list.length > 0) battle.runAction(battle.queue.shift()!);
  return worldState(battle, holder);
}

/**
 * Round 86 (B10): the rebuild's way, the boundary correction of a protocol that shows the faint and the switch-in on the slot while the simulator's
 * holder still stands (`faintThePredecessor` in `branch/entry-effects.ts`): the replacement is repointed into the slot first, and the faint of the
 * predecessor has to run its End events as if the replacement were not there yet.
 */
function replacedByCorrection(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = atBoundary(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  correctActivesFromProtocol(battle as never, ['|faint|p1a: Snorlax', '|switch|p1a: Gyarados|Gyarados, L50, F|100/100']);
  return worldState(battle, holder);
}

describe.each(RULE_SETS.flatMap(rules => (['singles', 'doubles'] as const).map(mode => ({ rules, mode, name: `${rules.name} ${mode}` }))))(
  'a body taken out as the simulator takes it out: $name', ({ rules, mode }) => {
    const abilities = endingAbilities(rules);

    test('the Dex has abilities with an End handler', () => {
      expect(abilities.length, `${rules.name}: abilities with onEnd`).toBeGreaterThan(0);
    });

    test('every ability with an End handler leaves the other bodies, the sides and the field as the simulator does', () => {
      const wrong = abilities.filter(ability => JSON.stringify(takenOut(rules, mode, ability)) !== JSON.stringify(faintedBySimulator(rules, mode, ability)));
      expect(wrong, `${rules.name} ${mode}: abilities whose end differs from the simulator's`).toEqual([]);
    });

    test('control: the flags alone differ from the simulator for the abilities whose end changes another body', () => {
      const changing = abilities.filter(ability => JSON.stringify(flagged(rules, mode, ability)) !== JSON.stringify(faintedBySimulator(rules, mode, ability)));
      if (abilities.includes('Neutralizing Gas')) expect(changing, `${rules.name}: Neutralizing Gas is one of them`).toContain('Neutralizing Gas');
    });

    // Round 86 (B10): the on-field path. The body leaves while a replacement already stands in its slot (the log's switch-in, repointed by the
    // correction), as in 2159578969 turn 2 (Weezing's gas, Grafaiai in its slot). The End events run with the holder on the field and the
    // replacement not yet in, then the replacement's own entry runs once.
    test('every ability with an End handler: the holder leaves a repointed slot as the simulator replaces it', () => {
      const wrong = abilities.filter(ability => JSON.stringify(replacedByCorrection(rules, mode, ability)) !== JSON.stringify(replacedBySimulator(rules, mode, ability)));
      expect(wrong, `${rules.name} ${mode}: abilities whose end differs from the simulator's replacement`).toEqual([]);
    });
  });
