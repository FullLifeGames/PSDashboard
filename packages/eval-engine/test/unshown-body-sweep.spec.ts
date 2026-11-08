import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations, type TurnSnapshot } from '@fulllifegames/replay-core';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { retireUnshownActives } from '../src/branch/unshown-actives';
import type { SimBattle } from '../src/branch/types';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeBattleStable } from '../src/forward-model';
import { mon, RULES, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 88 (T327, #63): the sweep of the body the log never shows. The simulator's own replacement round can send a bench body onto
 * a slot that the log leaves empty (VGC 2565721987: the simulator knocks out a body at 1 hit point that the log keeps alive, so it
 * forces a replacement the log does not have, and the unshown body stays on the field after the correction revived the log's own).
 * `retireUnshownActives` takes such a body out the way the simulator takes a fainted body out (`takeBodyOut`: the End events of its
 * ability and item run on the field, the fallen-ally count stays, as for an unbrought body), and only where the log's slot is empty.
 *
 * Every ability of the Dex with an End handler is played as the stranger's ability, in every rule set the corpus plays (Gens 3 to 9
 * where abilities exist, and the Champions mod), doubles for the scene and singles for the control (one slot, which the log never
 * leaves empty): the other bodies, both sides, the field and the fallen counts must read as after the simulator's own faint of the
 * stranger. The rest of the rows hold the guards: a body the log shows is never taken out, a disguise is never read as a stranger,
 * a slot the log fills keeps the bench body that the correction displaced (an unrevealed bench body of a bring-all game is alive),
 * and a board that stands as the log does is not touched.
 */

await loadSimMods('gen9championsou');

const RULE_SETS: Rules[] = RULES.filter(rules => rules.generation >= 3);
const withEvs = (rules: Rules) => (rules.evs ? { evs: rules.evs } : {});

/** The abilities of a rule set's Dex that carry an End handler: the ones whose end may change something. */
function endingAbilities(rules: Rules): string[] {
  const dex = dexOfRules(rules);
  return dex.abilities.all()
    .filter(ability => ability.exists && ability.gen <= dex.gen && (ability.isNonstandard === null || ability.isNonstandard === undefined || ability.isNonstandard === 'Past')
      && typeof (ability as { onEnd?: unknown }).onEnd === 'function')
    .map(ability => ability.name);
}

/** The abilities with a BeforeSwitchIn handler (Illusion): the Dex's own mark of a body that may show as another. */
function disguisingAbilities(rules: Rules): string[] {
  const dex = dexOfRules(rules);
  return dex.abilities.all()
    .filter(ability => ability.exists && ability.gen <= dex.gen && typeof (ability as { onBeforeSwitchIn?: unknown }).onBeforeSwitchIn === 'function')
    .map(ability => ability.name);
}

function witnessOf(rules: Rules): { species: string; ability: string } {
  return dexOfRules(rules).species.get('regigigas').exists ? { species: 'Regigigas', ability: 'Slow Start' } : { species: 'Slaking', ability: 'Truant' };
}
const witness = (rules: Rules) => set(witnessOf(rules).species, ['splash'], { level: rules.level, ability: witnessOf(rules).ability, ...withEvs(rules) });
const stranger = (rules: Rules, ability: string) => set('Snorlax', ['splash'], { level: rules.level, ability, ...withEvs(rules), gender: 'M' });
const plain = (rules: Rules, species: string): PokemonSet => mon(rules, { species, moves: ['splash'] });
const foes = (rules: Rules, mode: Mode) =>
  mode === 'singles' ? [witness(rules), plain(rules, 'Blissey')] : [witness(rules), plain(rules, 'Chansey'), plain(rules, 'Blissey')];

/** The log of a battle's first turn, as the snapshot reader takes it (no split lines). */
function startLog(battle: Battle): string {
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}
const snapshotOf = (battle: Battle): TurnSnapshot => parseReplayLogWithObservations(startLog(battle)).snapshots.find(snapshot => snapshot.turn === 1)!;

type Bench = 'none' | 'phantom' | 'shown';

interface Scene { battle: SimBattle; snapshot: TurnSnapshot; stranger: Pokemon }

/**
 * The scene in doubles: the log has the witness on p1a and a shown body (Blissey) fainted on p1b, so its second slot is empty. The
 * simulator's board has the stranger on p1b, and behind it `bench`: nothing, a body the log never shows (a phantom) or a living
 * body the log showed (Blissey, revived on the board).
 */
function doublesScene(rules: Rules, ability: string, bench: Bench): Scene {
  const game = battleOf(rules.doubles!, [witness(rules), plain(rules, 'Blissey')], foes(rules, 'doubles'));
  const snapshot = snapshotOf(game);
  const fell = snapshot.p1.pokemon.find(entry => entry.speciesForme === 'Blissey')!;
  Object.assign(fell, { fainted: true, isActive: false, hp: 0, hpPercent: 0 });
  delete fell.slot;
  const behind = bench === 'phantom' ? [plain(rules, 'Chansey')] : bench === 'shown' ? [plain(rules, 'Blissey')] : [];
  const battle = battleOf(rules.doubles!, [witness(rules), stranger(rules, ability), ...behind], foes(rules, 'doubles'));
  if (bench === 'shown') {
    // The log has Blissey on p1b alive, fainted at the end of the block: its entry stays alive on the bench of the board.
    Object.assign(fell, { fainted: false, hp: 50, hpPercent: 50, isActive: false });
  }
  return { battle: battle as unknown as SimBattle, snapshot, stranger: battle.sides[0].pokemon[1] };
}

/** The scene in singles: the log has the witness on the field, the board has the stranger there and the witness behind it. */
function singlesScene(rules: Rules, ability: string): Scene {
  const game = battleOf(rules.singles, [witness(rules), plain(rules, 'Blissey')], foes(rules, 'singles'));
  const battle = battleOf(rules.singles, [stranger(rules, ability), witness(rules)], foes(rules, 'singles'));
  return { battle: battle as unknown as SimBattle, snapshot: snapshotOf(game), stranger: battle.sides[0].pokemon[0] };
}

const SKIP = new Set(['target', 'source', 'battle', 'side', 'pokemon', 'sourceEffect', 'effect', 'sourceSlot']);
/** A JSON-safe copy of effect state: the references back to bodies and the battle drop out, everything else stays. */
const flat = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null, (key, entry) => (SKIP.has(key) ? undefined : entry)));

function bodyState(body: Pokemon): unknown {
  return {
    name: body.name, hp: body.hp, status: body.status, item: body.item, ability: body.ability, boosts: body.boosts,
    abilityState: flat(body.abilityState), itemState: flat(body.itemState), volatiles: flat(body.volatiles), types: body.getTypes(),
    moves: body.moveSlots.map(slot => [slot.id, slot.pp, slot.disabled]),
  };
}

/** Everything the End event of a body can change besides the body: the other bodies, the sides' counters and conditions, the field. */
function worldState(battle: Battle, removed: Pokemon): unknown {
  return {
    bodies: battle.sides.flatMap(side => side.pokemon).filter(body => body !== removed).map(bodyState),
    sides: battle.sides.map(side => ({ left: side.pokemonLeft, fallen: side.totalFainted, conditions: flat(side.sideConditions), slots: flat(side.slotConditions) })),
    field: { weather: battle.field.weather, weatherState: flat(battle.field.weatherState), terrain: battle.field.terrain, terrainState: flat(battle.field.terrainState), pseudo: flat(battle.field.pseudoWeather) },
    removed: { hp: removed.hp, fainted: removed.fainted || removed.faintQueued },
  };
}

/** The simulator's own faint of the stranger, with no fallen-ally count: the body was never in the game, as a retired bench body was not. */
function faintedBySimulator(rules: Rules, ability: string, bench: Bench): unknown {
  const { battle, stranger: holder } = doublesScene(rules, ability, bench);
  const fallen = holder.side.totalFainted;
  holder.faint();
  (battle as unknown as Battle).resolveFaints();
  holder.side.totalFainted = fallen;
  return worldState(battle as unknown as Battle, holder);
}

describe.each(RULE_SETS.flatMap(rules => (['doubles', 'singles'] as const).map(mode => ({ rules, mode, name: `${rules.name} ${mode}` }))))(
  'a body the log never shows leaves the field as the simulator takes a body out: $name', ({ rules, mode }) => {
    const abilities = endingAbilities(rules);

    test('the Dex has abilities with an End handler', () => {
      expect(abilities.length, `${rules.name}: abilities with onEnd`).toBeGreaterThan(0);
    });

    if (mode === 'doubles') {
      test('every ability with an End handler: the stranger on the slot the log leaves empty ends as the simulator ends a fainted body', () => {
        // A disguise (Illusion has an End handler) is no stranger: its own row below.
        const disguises = disguisingAbilities(rules);
        const wrong = abilities.filter(ability => !disguises.includes(ability)).filter(ability => {
          const scene = doublesScene(rules, ability, 'none');
          const out = retireUnshownActives(scene.battle, scene.snapshot);
          return !out.has(scene.stranger as never) || JSON.stringify(worldState(scene.battle as unknown as Battle, scene.stranger)) !== JSON.stringify(faintedBySimulator(rules, ability, 'none'));
        });
        expect(wrong, `${rules.name}: abilities whose end differs from the simulator's`).toEqual([]);
      });

      test('the log\'s own bodies stay: the witness and the foes are no stranger, and the stranger is the only body that leaves', () => {
        const scene = doublesScene(rules, 'Pressure', 'none');
        const out = retireUnshownActives(scene.battle, scene.snapshot);
        expect([...out].map(body => body.name)).toEqual([scene.stranger.name]);
        expect(scene.battle.sides[1].pokemon.every(body => !body.fainted)).toBe(true);
        expect(scene.battle.sides[0].pokemon.filter(body => !body.fainted).map(body => body.species.name)).toEqual([witnessOf(rules).species]);
      });

      test('a body that may disguise itself (an ability with a BeforeSwitchIn handler) is no stranger: it may be a shown body', () => {
        const disguises = disguisingAbilities(rules);
        const taken = disguises.filter(ability => {
          const scene = doublesScene(rules, ability, 'none');
          return retireUnshownActives(scene.battle, scene.snapshot).size > 0;
        });
        expect(taken, `${rules.name}: disguising abilities read as strangers`).toEqual([]);
      });

      test('a board that stands as the log does is not touched: no body leaves and the battle serializes as before', () => {
        const game = battleOf(rules.doubles!, [witness(rules), plain(rules, 'Blissey')], foes(rules, 'doubles'));
        const battle = battleOf(rules.doubles!, [witness(rules), plain(rules, 'Blissey')], foes(rules, 'doubles')) as unknown as SimBattle;
        const before = serializeBattleStable(battle);
        expect(retireUnshownActives(battle, snapshotOf(game)).size).toBe(0);
        expect(serializeBattleStable(battle)).toBe(before);
      });

      test('a slot the log fills is no empty slot: a stranger beside the log\'s two bodies stays (it is the correction\'s to displace, not to retire)', () => {
        const game = battleOf(rules.doubles!, [witness(rules), plain(rules, 'Blissey')], foes(rules, 'doubles'));
        const battle = battleOf(rules.doubles!, [witness(rules), stranger(rules, 'Pressure'), plain(rules, 'Blissey')], foes(rules, 'doubles')) as unknown as SimBattle;
        const before = serializeBattleStable(battle);
        expect(retireUnshownActives(battle, snapshotOf(game)).size).toBe(0);
        expect(serializeBattleStable(battle)).toBe(before);
      });

      test('the whole correction: the stranger leaves, the bench bodies the log never shows leave with it, the game goes on', () => {
        const scene = doublesScene(rules, 'Pressure', 'phantom');
        correctBattleFromSnapshot(scene.battle, scene.snapshot);
        const side = scene.battle.sides[0];
        expect(side.pokemon.filter(body => !body.fainted).map(body => body.species.name)).toEqual([witnessOf(rules).species]);
        expect(side.pokemonLeft).toBe(1);
        // Neither body is a fallen ally: the stranger and the phantom were never in the game.
        expect(side.totalFainted).toBe(0);
        expect(scene.battle.ended).toBe(false);
      });

      test('the whole correction, a shown body alive behind the empty slot: the stranger leaves, the bench stays', () => {
        const scene = doublesScene(rules, 'Pressure', 'shown');
        correctBattleFromSnapshot(scene.battle, scene.snapshot);
        const side = scene.battle.sides[0];
        expect(side.pokemon.filter(body => !body.fainted).map(body => body.species.name).sort()).toEqual(['Blissey', witnessOf(rules).species].sort());
        expect(scene.battle.ended).toBe(false);
      });
    } else {
      test('every ability with an End handler: the stranger on the one slot, which the log never leaves empty, stays and the board is untouched', () => {
        const wrong = abilities.filter(ability => {
          const scene = singlesScene(rules, ability);
          const before = serializeBattleStable(scene.battle);
          return retireUnshownActives(scene.battle, scene.snapshot).size > 0 || serializeBattleStable(scene.battle) !== before;
        });
        expect(wrong, `${rules.name}: abilities whose stranger left a singles field`).toEqual([]);
      });

      test('the whole correction: the log\'s body takes the field and the unrevealed body stays alive on the bench (a bring-all game)', () => {
        const scene = singlesScene(rules, 'Pressure');
        correctBattleFromSnapshot(scene.battle, scene.snapshot);
        const side = scene.battle.sides[0];
        expect(side.active.map(body => body.species.name)).toEqual([witnessOf(rules).species]);
        expect(side.pokemon.filter(body => !body.fainted).length).toBe(2);
      });
    }
  });

describe('both sides: the rule reads the side the stranger stands on', () => {
  const rules = RULE_SETS.find(entry => entry.generation === 9 && !entry.evs)!;
  test('a stranger of p2 leaves, and p1 stays whole', () => {
    const game = battleOf(rules.doubles!, foes(rules, 'doubles').slice(0, 2), [witness(rules), plain(rules, 'Blissey')]);
    const snapshot = snapshotOf(game);
    const fell = snapshot.p2.pokemon.find(entry => entry.speciesForme === 'Blissey')!;
    Object.assign(fell, { fainted: true, isActive: false, hp: 0, hpPercent: 0 });
    delete fell.slot;
    const battle = battleOf(rules.doubles!, foes(rules, 'doubles').slice(0, 2), [witness(rules), stranger(rules, 'Pressure')]) as unknown as SimBattle;
    const out = retireUnshownActives(battle, snapshot);
    expect([...out].map(body => body.side.id)).toEqual(['p2']);
    expect(battle.sides[0].pokemon.every(body => !body.fainted)).toBe(true);
  });
});
