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

await loadSimMods('gen9championsou');

const RULE_SETS: Rules[] = RULES.filter(rules => rules.generation >= 3);

function endingAbilities(rules: Rules): string[] {
  const dex = dexOfRules(rules);
  return dex.abilities.all()
    .filter(ability => ability.exists && ability.gen <= dex.gen && (ability.isNonstandard === null || ability.isNonstandard === undefined || ability.isNonstandard === 'Past')
      && typeof (ability as { onEnd?: unknown }).onEnd === 'function')
    .map(ability => ability.name);
}

function witnessOf(rules: Rules): { species: string; ability: string } {
  return dexOfRules(rules).species.get('regigigas').exists ? { species: 'Regigigas', ability: 'Slow Start' } : { species: 'Slaking', ability: 'Truant' };
}

const intimidator = (rules: Rules) => set('Gyarados', ['splash'], { level: rules.level, ability: 'Intimidate', ...(rules.evs ? { evs: rules.evs } : {}) });

function board(rules: Rules, mode: Mode, ability: string, entering?: PokemonSet): Battle {
  const witness = () => set(witnessOf(rules).species, ['splash'], { level: rules.level, ability: witnessOf(rules).ability, ...(rules.evs ? { evs: rules.evs } : {}) });
  const bench = () => entering ?? mon(rules, { species: 'Blissey', moves: ['splash'] });
  const holder = set('Snorlax', ['splash'], { level: rules.level, ability, ...(rules.evs ? { evs: rules.evs } : {}), gender: 'M' });
  const p1 = mode === 'singles' ? [holder, bench()] : [holder, witness(), bench()];
  const p2 = mode === 'singles' ? [witness(), mon(rules, { species: 'Blissey', moves: ['splash'] })] : [witness(), mon(rules, { species: 'Chansey', moves: ['splash'] }), mon(rules, { species: 'Blissey', moves: ['splash'] })];
  return battleOf(mode === 'singles' ? rules.singles : rules.doubles!, p1, p2);
}

const SKIP = new Set(['target', 'source', 'battle', 'side', 'pokemon', 'sourceEffect', 'effect', 'sourceSlot']);
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null, (key, entry) => (SKIP.has(key) ? undefined : entry)));

function bodyState(body: Pokemon): unknown {
  return {
    name: body.name, hp: body.hp, status: body.status, item: body.item, ability: body.ability, boosts: body.boosts,
    abilityState: plain(body.abilityState), itemState: plain(body.itemState), volatiles: plain(body.volatiles), types: body.getTypes(),
    moves: body.moveSlots.map(slot => [slot.id, slot.pp, slot.disabled]),
  };
}

function worldState(battle: Battle, removed: Pokemon): unknown {
  return {
    bodies: battle.sides.flatMap(side => side.pokemon).filter(body => body !== removed).map(bodyState),
    sides: battle.sides.map(side => ({ left: side.pokemonLeft, fallen: side.totalFainted, conditions: plain(side.sideConditions), slots: plain(side.slotConditions) })),
    field: { weather: battle.field.weather, weatherState: plain(battle.field.weatherState), terrain: battle.field.terrain, terrainState: plain(battle.field.terrainState), pseudo: plain(battle.field.pseudoWeather) },
    removed: { hp: removed.hp, fainted: removed.fainted || removed.faintQueued },
  };
}

function faintedBySimulator(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = board(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  holder.faint();
  battle.resolveFaints();
  return worldState(battle, holder);
}

function takenOut(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = board(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  takeBodyOut(holder as unknown as SimPokemon, { fallen: true });
  return worldState(battle, holder);
}

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

function atBoundary(rules: Rules, mode: Mode, ability: string): Battle {
  const battle = board(rules, mode, ability, intimidator(rules));
  const clicks = mode === 'singles' ? 'move 1' : 'move 1, move 1';
  battle.choose('p1', clicks);
  battle.choose('p2', clicks);
  return battle;
}

const protocolBody = (battle: Battle) => battle.sides[0].pokemon.find(body => body.species.name === 'Gyarados')!;

function replacedBySimulator(rules: Rules, mode: Mode, ability: string): unknown {
  const battle = atBoundary(rules, mode, ability);
  const holder = battle.sides[0].active[0]!;
  holder.faint();
  battle.resolveFaints();
  battle.actions.switchIn(protocolBody(battle), 0);
  while (battle.queue.list.length > 0) battle.runAction(battle.queue.shift()!);
  return worldState(battle, holder);
}

// The rebuild's way (`faintThePredecessor`, `branch/entry-effects.ts`): the replacement is repointed into the slot,
// and the predecessor's faint must run its End events as if the replacement were not there yet.
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

    test('every ability with an End handler: the holder leaves a repointed slot as the simulator replaces it', () => {
      const wrong = abilities.filter(ability => JSON.stringify(replacedByCorrection(rules, mode, ability)) !== JSON.stringify(replacedBySimulator(rules, mode, ability)));
      expect(wrong, `${rules.name} ${mode}: abilities whose end differs from the simulator's replacement`).toEqual([]);
    });
  });
