import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ActiveMove, Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { shieldsFromHits, shieldsSide } from '../src/dex-facts/protect';
import { loadSimMods } from '../src/forward/sim-mods';
import { copyOf, FixedDice, protectorStops, setAskCheck } from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T256, step 7d): the answers of `protectorStops` are shared per Dex, so a first question on a body is rare. The
 * memo is exact only if what a protector's handler reads about a hit is the attack and the HitProtect handlers on the field.
 * This sweep plays every protector of the Dex (the Protect family of dex-facts/protect.ts) against a class of attacks on boards
 * that differ in everything else a handler could read (status, lockedmove, items, abilities, HP, stages, terrain, weather, the
 * pseudo-weathers, Dynamax, the partners), in two orders, so each key is filled by a different board in each pass. The reference is the
 * protector's own handler on a copy of that board. With the development check off, the memo answers alone.
 */

await loadSimMods('gen9championsou');

beforeAll(() => setAskCheck(false));
afterAll(() => setAskCheck(null));

interface Rules { name: string; format: string; level: number; doubles: boolean; evs?: PokemonSet['evs']; everyItem?: boolean }

const CHAMPIONS_EVS = { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 };
const RULES: Rules[] = [
  { name: 'Scarlet/Violet doubles', format: 'gen9doublescustomgame', level: 100, doubles: true, everyItem: true },
  { name: 'Pokémon Champions doubles', format: 'gen9championsdoublescustomgame', level: 50, doubles: true, evs: CHAMPIONS_EVS, everyItem: true },
  { name: 'Generation 8 doubles', format: 'gen8doublescustomgame', level: 100, doubles: true },
  { name: 'Generation 6 doubles', format: 'gen6doublescustomgame', level: 100, doubles: true },
  { name: 'Generation 5 doubles', format: 'gen5doublescustomgame', level: 100, doubles: true },
  { name: 'Generation 4 doubles', format: 'gen4doublescustomgame', level: 100, doubles: true },
  { name: 'Generation 7 singles', format: 'gen7customgame', level: 100, doubles: false },
  { name: 'Pokémon Champions singles', format: 'gen9championscustomgame', level: 50, doubles: false, evs: CHAMPIONS_EVS },
];

type Mutation = (battle: Battle, source: Pokemon, target: Pokemon) => void;
interface Board { label: string; apply: Mutation }

const monOf = (rules: Rules, species: string, moves: string[]) => set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}) });

/** A fresh board: side two's first body hits side one's first body. */
function freshBoard(rules: Rules): Battle {
  const mine = [monOf(rules, 'Blissey', ['splash'])];
  const theirs = [monOf(rules, 'Shuckle', ['splash'])];
  if (rules.doubles) { mine.push(monOf(rules, 'Blissey', ['splash'])); theirs.push(monOf(rules, 'Shuckle', ['splash'])); }
  return battleOf(rules.format, mine, theirs);
}

type Holder = { ability: string; baseAbility: string; abilityState: unknown; item: string; itemState: unknown };
const giveAbility = (battle: Battle, mon: Pokemon, id: string) => {
  const held = mon as unknown as Holder;
  held.ability = id;
  held.baseAbility = id;
  held.abilityState = (battle as unknown as { initEffectState(state: object): unknown }).initEffectState({ id, target: mon });
};
const giveItem = (battle: Battle, mon: Pokemon, id: string) => {
  const held = mon as unknown as Holder;
  held.item = id;
  held.itemState = (battle as unknown as { initEffectState(state: object): unknown }).initEffectState({ id, target: mon });
};
const give = (battle: Battle, mon: Pokemon, volatile: string, state: object) => {
  (mon.volatiles as Record<string, unknown>)[volatile] = (battle as unknown as { initEffectState(state: object): unknown }).initEffectState({ id: volatile, target: mon, ...state });
};

/** The boards that vary what a handler could read besides the attack. */
function handBoards(dex: Battle['dex'], doubles: boolean): Board[] {
  const boards: Board[] = [{ label: 'plain', apply: () => undefined }];
  for (const status of ['psn', 'tox', 'brn', 'par', 'slp', 'frz']) {
    boards.push({ label: `source ${status}`, apply: (_b, source) => { source.status = status as never; } });
    boards.push({ label: `target ${status}`, apply: (_b, _s, target) => { target.status = status as never; } });
  }
  boards.push({ label: 'lockedmove at 2', apply: (b, source) => give(b, source, 'lockedmove', { duration: 2, trueDuration: 3, move: 'outrage' }) });
  boards.push({ label: 'lockedmove at 1', apply: (b, source) => give(b, source, 'lockedmove', { duration: 1, trueDuration: 1, move: 'outrage' }) });
  boards.push({ label: 'source at 1 HP', apply: (_b, source) => { source.hp = 1; } });
  boards.push({ label: 'target at 1 HP', apply: (_b, _s, target) => { target.hp = 1; } });
  boards.push({ label: 'stages', apply: (_b, source, target) => { source.boosts.atk = 6; source.boosts.spe = -6; target.boosts.def = -6; target.boosts.evasion = 6; } });
  for (const [kind, id] of [['terrain', 'grassyterrain'], ['terrain', 'psychicterrain'], ['terrain', 'mistyterrain'], ['weather', 'sunnyday'], ['weather', 'raindance'], ['weather', 'sandstorm'], ['pseudo', 'trickroom'], ['pseudo', 'gravity']]) {
    boards.push({ label: id, apply: (b, source) => {
      if (kind === 'terrain') b.field.setTerrain(id, source);
      else if (kind === 'weather') b.field.setWeather(id, source);
      else b.field.addPseudoWeather(id, source);
    } });
  }
  boards.push({ label: 'side conditions', apply: (_b, source, target) => {
    for (const [side, id] of [[source.side, 'tailwind'], [target.side, 'reflect'], [target.side, 'lightscreen'], [source.side, 'stealthrock']] as const) side.addSideCondition(id, source);
  } });
  if (dex.gen === 8) {
    boards.push({ label: 'source dynamaxed', apply: (b, source) => give(b, source, 'dynamax', { duration: 3 }) });
    boards.push({ label: 'target dynamaxed', apply: (b, _s, target) => give(b, target, 'dynamax', { duration: 3 }) });
  }
  if (doubles) {
    for (const ability of ['unseenfist', 'piercingdrill']) {
      boards.push({ label: `source partner ${ability}`, apply: (b, source) => giveAbility(b, source.side.active[1] as Pokemon, ability) });
      boards.push({ label: `target partner ${ability}`, apply: (b, _s, target) => giveAbility(b, target.side.active[1] as Pokemon, ability) });
    }
  }
  return boards;
}

/** One board per ability of the Dex on the attacker, then on the defender; one per item with a handler on the attacker. */
function dexBoards(dex: Battle['dex'], everyItem: boolean): Board[] {
  const boards: Board[] = [];
  const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && ability.id !== 'noability');
  for (const ability of abilities) {
    boards.push({ label: `source ability ${ability.id}`, apply: (b, source) => giveAbility(b, source, ability.id) });
    boards.push({ label: `target ability ${ability.id}`, apply: (b, _s, target) => giveAbility(b, target, ability.id) });
  }
  const items = dex.items.all().filter(item => item.exists && item.gen <= dex.gen && Object.keys(item).some(key => /^on[A-Z]/.test(key)));
  for (const item of everyItem ? items : items.filter(each => each.id === 'protectivepads')) {
    boards.push({ label: `source item ${item.id}`, apply: (b, source) => giveItem(b, source, item.id) });
  }
  return boards;
}

/** One move per class of what the protectors' handlers read: protect flag, contact, target, category, priority, Z and Max. */
function attackClasses(dex: Battle['dex']): string[] {
  const seen = new Map<string, string>();
  for (const move of dex.moves.all()) {
    if (!move.exists) continue;
    const key = [!!move.flags.protect, !!move.flags.contact, move.isZ ? 'Z' : '', move.isMax ? 'M' : '', move.target, move.category, move.priority > 0 ? 'prio' : move.priority < 0 ? 'slow' : ''].join('|');
    if (!seen.has(key)) seen.set(key, move.id);
  }
  return [...seen.values()];
}

/** The four attacks that tell an ability or an item from another: contact, plain, spread, priority (all with the protect flag), and one without it. */
function probeAttacks(dex: Battle['dex']): string[] {
  const pick = (test: (move: ReturnType<Battle['dex']['moves']['get']>) => boolean) => dex.moves.all().find(move => move.exists && !move.isZ && !move.isMax && move.category !== 'Status' && test(move))?.id;
  return [
    pick(move => !!move.flags.protect && !!move.flags.contact && move.target === 'normal'),
    pick(move => !!move.flags.protect && !move.flags.contact && move.target === 'normal'),
    pick(move => !!move.flags.protect && (move.target === 'allAdjacentFoes' || move.target === 'allAdjacent')),
    pick(move => !!move.flags.protect && move.priority > 0),
    pick(move => !move.flags.protect),
  ].filter((id): id is string => !!id);
}

/** The simulator's answer: the protector's own handler on a copy of the board, with the copy's bodies and the attack. */
function stopsOnCopy(battle: Battle, handler: unknown, attack: ActiveMove, source: Pokemon, target: Pokemon): boolean {
  const copy = copyOf(battle);
  copy.prng = new FixedDice({});
  const at = (mon: Pokemon) => copy.sides[mon.side.n].pokemon[mon.side.pokemon.indexOf(mon)];
  try {
    return (handler as (this: Battle, target: Pokemon, source: Pokemon, move: ActiveMove) => unknown).call(copy, at(target), at(source), attack) !== undefined;
  } catch {
    return false;
  }
}

/** Attacks the way a caller could hand them: fresh, with the target at use, and edited in a property a handler reads. */
function variantsOf(dex: Battle['dex'], id: string): { label: string; make: () => ActiveMove }[] {
  const fresh = () => dex.getActiveMove(id);
  const edit = (label: string, change: (move: ActiveMove) => void) => ({ label, make: () => { const move = fresh(); change(move); return move; } });
  return [
    { label: id, make: fresh },
    edit(`${id} aimed at all foes`, move => { move.target = 'allAdjacentFoes'; }),
    edit(`${id} aimed at one`, move => { move.target = 'normal'; }),
    edit(`${id} with priority`, move => { move.priority += 1; }),
    edit(`${id} without the protect flag`, move => { delete move.flags.protect; }),
    edit(`${id} with the contact flag`, move => { move.flags.contact = 1; }),
    edit(`${id} as a status move`, move => { move.category = 'Status'; }),
    edit(`${id} smart-targeted`, move => { move.smartTarget = true; }),
    edit(`${id} bounced`, move => { move.hasBounced = true; }),
  ];
}

describe.each(RULES)('$name: the shared answers of protectorStops equal a copy of the board (round 72, T256)', rules => {
  const base = freshBoard(rules);
  const dex = base.dex;
  const protectors = dex.moves.all()
    .filter(move => move.exists && move.gen <= dex.gen && (shieldsFromHits(dex, move) || shieldsSide(dex, move)))
    .filter(move => typeof (dex.conditions.get(move.sideCondition || move.volatileStatus) as { onTryHit?: unknown }).onTryHit === 'function');
  const hand = handBoards(dex, rules.doubles);
  const everyAttack = attackClasses(dex);
  const probes = probeAttacks(dex);
  const boards: Board[] = [...hand, ...dexBoards(dex, !!rules.everyItem)];

  /** One pass over the boards in one order; a derived Dex object gives the pass a memo of its own. */
  function pass(order: Board[]): string[] {
    const wrong: string[] = [];
    const memoDex = Object.create(dex) as Battle['dex'];
    for (const board of order) {
      const battle = freshBoard(rules);
      (battle as unknown as { dex: Battle['dex'] }).dex = memoDex;
      const [source, target] = [battle.sides[1].active[0] as Pokemon, battle.sides[0].active[0] as Pokemon];
      board.apply(battle, source, target);
      const plain = board.label === 'plain';
      for (const protector of protectors) {
        const condition = protector.sideCondition || protector.volatileStatus;
        const handler = (dex.conditions.get(condition) as { onTryHit?: unknown }).onTryHit;
        for (const id of plain ? [...new Set([...everyAttack, ...probes])] : probes) {
          const variants = plain && probes.includes(id) ? variantsOf(dex, id) : variantsOf(dex, id).slice(0, 2);
          for (const variant of variants) {
            const read = protectorStops(battle, protector, variant.make(), source, target);
            if (read !== stopsOnCopy(battle, handler, variant.make(), source, target)) wrong.push(`${board.label}: ${protector.id} against ${variant.label}`);
          }
        }
      }
    }
    return wrong;
  }

  test('the sweep covers the family, the boards and the Unseen Fist and Piercing Drill boards', () => {
    expect(protectors.length).toBeGreaterThanOrEqual(rules.format.includes('gen4') ? 2 : 4);
    expect(everyAttack.length).toBeGreaterThan(20);
    expect(probes.length).toBeGreaterThanOrEqual(4);
    expect(boards.length).toBeGreaterThan(40);
    const labels = new Set(boards.map(board => board.label));
    if (dex.gen >= 9) {
      expect(labels.has('source ability unseenfist')).toBe(true);
      expect(labels.has('source ability piercingdrill')).toBe(true);
    }
  });

  test('forward order: each key is filled by the first board that asks it', () => {
    expect(pass(boards)).toEqual([]);
  }, 600_000);

  test('reverse order: each key is filled by the last board', () => {
    expect(pass([...boards].reverse())).toEqual([]);
  }, 600_000);
});
