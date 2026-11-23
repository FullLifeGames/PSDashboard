import { beforeAll, describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotModifiers } from '@fulllifegames/eval-engine';
import { Dex, Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import {
  loadSimMods,
  createBranchStateFromBattle,
  requiredChoicesForActiveSlots,
  resolveSideChoices,
  type BranchMoveModifier,
  type BranchSimState,
  type BranchSlotChoice,
} from '@fulllifegames/eval-engine';
import { useGimmickToggles, useMovePool } from '../../../src/hooks/useSideControlsState';
import { getMovePool } from '../../../src/lib/pokemon-options';
import { NO_MODIFIERS } from '../fixtures/sim-state';
import { moveChoiceFor } from '../../../src/components/branch/choice-context';

const withTera: BranchSlotModifiers = { ...NO_MODIFIERS, teraType: 'Fire' };
const withMega: BranchSlotModifiers = { ...NO_MODIFIERS, canMegaEvo: true };
const withZ: BranchSlotModifiers = { ...NO_MODIFIERS, zMoves: [null, 'Inferno Overdrive', null, null] };

type Sides = { p1: BranchSlotModifiers[]; p2: BranchSlotModifiers[] };
/** The panel's toggles over one position; `p1A` reads P1's first slot. */
function renderToggles(initial: Sides) {
  const hook = renderHook((sides: Sides) => useGimmickToggles(sides.p1, sides.p2), { initialProps: initial });
  return { ...hook, p1A: () => hook.result.current.gimmickFor('p1', 0) };
}

describe('useGimmickToggles', () => {
  test('nothing to toggle without a gimmick on the active Pokémon', () => {
    const { p1A } = renderToggles({ p1: [NO_MODIFIERS], p2: [NO_MODIFIERS] });
    expect(p1A()).toMatchObject({ modifier: null, modifierAvailable: false, hasZMoves: false, hasAnyModifier: false });
  });

  test('tera toggles on and off; mega and Z-moves follow the same switch', () => {
    const { p1A } = renderToggles({ p1: [withTera], p2: [NO_MODIFIERS] });
    expect(p1A().hasAnyModifier).toBe(true);
    act(() => p1A().toggle('terastallize'));
    expect(p1A()).toMatchObject({ modifier: 'terastallize', modifierAvailable: true });
    act(() => p1A().toggle('terastallize'));
    expect(p1A().modifier).toBeNull();

    const mega = renderToggles({ p1: [withMega], p2: [] });
    act(() => mega.p1A().toggle('mega'));
    expect(mega.p1A()).toMatchObject({ modifier: 'mega', modifierAvailable: true });

    const z = renderToggles({ p1: [withZ], p2: [] });
    expect(z.p1A().hasZMoves).toBe(true);
    act(() => z.p1A().toggle('zmove'));
    expect(z.p1A().modifierAvailable).toBe(true);
  });

  test('a spent or foreign gimmick drops the toggle instead of sticking to the next move', () => {
    const { p1A, rerender } = renderToggles({ p1: [withTera], p2: [] });
    act(() => p1A().toggle('terastallize'));
    expect(p1A().modifier).toBe('terastallize');
    rerender({ p1: [NO_MODIFIERS], p2: [] });
    expect(p1A()).toMatchObject({ modifier: null, modifierAvailable: false });
    rerender({ p1: [withTera], p2: [] });
    expect(p1A().modifier).toBeNull();

    act(() => p1A().toggle('mega'));
    expect(p1A().modifierAvailable).toBe(false);
  });

  test('every slot of both sides keeps its own toggle', () => {
    const { result } = renderToggles({ p1: [withTera, withTera], p2: [withMega, withTera] });
    act(() => result.current.gimmickFor('p1', 1).toggle('terastallize'));
    act(() => result.current.gimmickFor('p2', 0).toggle('mega'));
    expect(result.current.gimmickFor('p1', 0).modifier).toBeNull();
    expect(result.current.gimmickFor('p1', 1).modifier).toBe('terastallize');
    expect(result.current.gimmickFor('p2', 0).modifier).toBe('mega');
    expect(result.current.gimmickFor('p2', 1).modifier).toBeNull();
  });

  test('teraBySlot names the type of every armed Tera toggle and nothing else (decision 18)', () => {
    const steel = { ...withTera, teraType: 'Steel' };
    const { result } = renderToggles({ p1: [withTera, withMega], p2: [steel] });
    expect(result.current.teraBySlot).toEqual({ p1: [null, null], p2: [null] });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    act(() => result.current.gimmickFor('p1', 1).toggle('mega'));
    act(() => result.current.gimmickFor('p2', 0).toggle('terastallize'));
    expect(result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: ['Steel'] });
  });

  test('armed toggles belong to one position: a new position key starts every slot unarmed (T124 point 2)', () => {
    const sides = { p1: [withTera, withMega], p2: [withTera] };
    const hook = renderHook(({ key }: { key: string }) => useGimmickToggles(sides.p1, sides.p2, key), { initialProps: { key: 'r1:main:2' } });
    act(() => hook.result.current.gimmickFor('p1', 0).toggle('terastallize'));
    act(() => hook.result.current.gimmickFor('p1', 1).toggle('mega'));
    act(() => hook.result.current.gimmickFor('p2', 0).toggle('terastallize'));
    expect(hook.result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: ['Fire'] });
    hook.rerender({ key: 'r1:main:2' });
    expect(hook.result.current.gimmickFor('p1', 1).modifier).toBe('mega');
    hook.rerender({ key: 'r1:main:3' });
    expect([hook.result.current.gimmickFor('p1', 0).modifier, hook.result.current.gimmickFor('p1', 1).modifier,
      hook.result.current.gimmickFor('p2', 0).modifier]).toEqual([null, null, null]);
    expect(hook.result.current.teraBySlot).toEqual({ p1: [null, null], p2: [null] });
    // Back on the old position the toggles stay released: an arming belongs to the visit, not to the turn.
    hook.rerender({ key: 'r1:main:2' });
    expect(hook.result.current.gimmickFor('p1', 0).modifier).toBeNull();
  });

  test('a gimmick one slot holds, armed or in its pending choice, is out of reach for the side\'s other slots (T124 point 1)', () => {
    const { result } = renderToggles({ p1: [withTera, withTera], p2: [withTera] });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(result.current.gimmickFor('p1', 1).heldBy).toEqual({ terastallize: 'P1A' });
    act(() => result.current.gimmickFor('p1', 1).toggle('terastallize'));
    expect(result.current.gimmickFor('p1', 1).modifier).toBeNull();
    expect(result.current.gimmickFor('p1', 0).heldBy).toEqual({});
    expect(result.current.gimmickFor('p2', 0).heldBy).toEqual({});
    expect(result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: [null] });

    const pick = { kind: 'move' as const, moveId: 'flareblitz', moveName: 'Flare Blitz', modifier: 'terastallize' as const };
    const pending = renderHook(() => useGimmickToggles([withTera, withTera], [], 'k', { p1: [null, pick], p2: [] }));
    expect(pending.result.current.gimmickFor('p1', 0).heldBy).toEqual({ terastallize: 'P1B' });
    act(() => pending.result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(pending.result.current.gimmickFor('p1', 0).modifier).toBeNull();
  });

  test('a slot with a pick holds only what the pick carries: a switch or a plain move frees its armed Tera for the partner (review of wave 1.5)', () => {
    const switchPick = { kind: 'switch' as const, speciesId: 'rillaboom', pokemonName: 'Rillaboom' };
    const plainMove = { kind: 'move' as const, moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1 };
    for (const pick of [switchPick, plainMove]) {
      type Pending = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };
      const hook = renderHook(({ pending }: { pending: Pending }) => useGimmickToggles([withTera, withTera], [], 'k', pending),
        { initialProps: { pending: { p1: [null, null], p2: [] } as Pending } });
      const slotOf = (slot: number) => hook.result.current.gimmickFor('p1', slot);
      act(() => slotOf(0).toggle('terastallize'));
      expect(slotOf(1).heldBy, pick.kind).toEqual({ terastallize: 'P1A' });
      hook.rerender({ pending: { p1: [pick, null], p2: [] } });
      expect(slotOf(1).heldBy, pick.kind).toEqual({});
      act(() => slotOf(1).toggle('terastallize'));
      expect(slotOf(1).modifier, pick.kind).toBe('terastallize');
      // P1A's armed Tera gives way, so a new pick there cannot carry a second Tera.
      expect(slotOf(0), pick.kind).toMatchObject({ modifier: null, modifierAvailable: false, heldBy: { terastallize: 'P1B' } });
      expect(hook.result.current.teraBySlot.p1, pick.kind).toEqual([null, 'Fire']);
    }
  });

  test('teraBySlot keeps its identity across renders until a toggle changes', () => {
    const sides = { p1: [withTera], p2: [NO_MODIFIERS] };
    const { result, rerender } = renderToggles(sides);
    const first = result.current.teraBySlot;
    rerender(sides);
    expect(result.current.teraBySlot).toBe(first);
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(result.current.teraBySlot).not.toBe(first);
  });
});

/** With a pick standing on a slot (the seed or the user's), the gimmick toggle edits that pick instead of arming the next click; a slot without a move pick keeps the armed toggle. */
describe('useGimmickToggles on a slot with a move pick (round 84, C4)', () => {
  const flare = { kind: 'move' as const, moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 1 };
  const spore = { kind: 'move' as const, moveId: 'spore', moveName: 'Spore' };
  const switchPick = { kind: 'switch' as const, speciesId: 'rillaboom', pokemonName: 'Rillaboom' };
  type Pending = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

  function renderEditing(pending: Pending, modifiers: Sides = { p1: [withTera, withTera], p2: [] }) {
    const edits: [string, number, BranchSlotChoice][] = [];
    const hook = renderHook(({ now }: { now: Pending }) => useGimmickToggles(modifiers.p1, modifiers.p2, 'k', now, {
      onEdit: (side, slot, choice) => edits.push([side, slot, choice]),
    }), { initialProps: { now: pending } });
    return { ...hook, edits };
  }

  test('the toggle writes the modifier into the pick and shows pressed from it', () => {
    const { result, rerender, edits } = renderEditing({ p1: [flare, null], p2: [] });
    expect(result.current.gimmickFor('p1', 0).modifier).toBeNull();
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(edits).toEqual([['p1', 0, { ...flare, modifier: 'terastallize' }]]);
    // the caller stores the edited pick; the toggle reads it back
    rerender({ now: { p1: [{ ...flare, modifier: 'terastallize' }, null], p2: [] } });
    expect(result.current.gimmickFor('p1', 0)).toMatchObject({ modifier: 'terastallize', modifierAvailable: true });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(edits[1]).toEqual(['p1', 0, flare]);
    expect(edits[1][2]).not.toHaveProperty('modifier');
  });

  test('an edit never arms the toggle for the next click', () => {
    const { result, rerender } = renderEditing({ p1: [flare, null], p2: [] });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    // the pick goes away (a switch replaces it): nothing stays armed behind it
    rerender({ now: { p1: [switchPick, null], p2: [] } });
    expect(result.current.gimmickFor('p1', 0).modifier).toBeNull();
  });

  test('teraBySlot names the Tera type from the pick', () => {
    const { result } = renderEditing({ p1: [{ ...flare, modifier: 'terastallize' }, spore], p2: [] });
    expect(result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: [] });
  });

  test('the partner holding the gimmick blocks the edit', () => {
    const { result, edits } = renderEditing({ p1: [flare, { ...spore, modifier: 'terastallize' }], p2: [] });
    expect(result.current.gimmickFor('p1', 0).heldBy).toEqual({ terastallize: 'P1B' });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(edits).toEqual([]);
  });

  test('a slot that does not offer the gimmick takes no edit', () => {
    const { result, edits } = renderEditing({ p1: [flare, spore], p2: [] }, { p1: [withTera, NO_MODIFIERS], p2: [] });
    act(() => result.current.gimmickFor('p1', 1).toggle('terastallize'));
    expect(edits).toEqual([]);
  });

  test('a switch or an empty slot still arms the toggle for the next click', () => {
    const { result, edits } = renderEditing({ p1: [switchPick, null], p2: [] });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    act(() => result.current.gimmickFor('p1', 1).toggle('terastallize'));
    expect(edits).toEqual([]);
    expect(result.current.gimmickFor('p1', 1).modifier).toBe('terastallize');
  });

  test('a Z-Move toggle edits only a move that has a Z option', () => {
    const moves = { p1: [[
      { name: 'Dragon Claw', slot: 1 }, { name: 'Flamethrower', slot: 2 },
    ]] } as never;
    const withZ = { ...NO_MODIFIERS, zMoves: [null, 'Inferno Overdrive'] };
    const edits: BranchSlotChoice[] = [];
    const claw = { kind: 'move' as const, moveId: 'dragonclaw', moveName: 'Dragon Claw' };
    const flame = { kind: 'move' as const, moveId: 'flamethrower', moveName: 'Flamethrower' };
    const hook = renderHook(({ pick }: { pick: BranchSlotChoice }) => useGimmickToggles([withZ], [], 'k', { p1: [pick], p2: [] }, {
      onEdit: (_side, _slot, choice) => edits.push(choice), movesBySlot: moves,
    }), { initialProps: { pick: claw as BranchSlotChoice } });
    act(() => hook.result.current.gimmickFor('p1', 0).toggle('zmove'));
    expect(edits).toEqual([]);
    hook.rerender({ pick: flame });
    act(() => hook.result.current.gimmickFor('p1', 0).toggle('zmove'));
    expect(edits).toEqual([{ ...flame, modifier: 'zmove' }]);
  });
});

describe('useMovePool', () => {
  test('loads the legal gen 9 pool of the active species', async () => {
    const { result } = renderHook(() => useMovePool('Garchomp', 9));
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current.length).toBeGreaterThan(20), { timeout: 20_000 });
    expect(result.current).toContain('Earthquake');
    expect(result.current).toContain('Dragon Claw');
    expect(result.current).not.toContain('Spore');
  }, 30_000);

  test('a species change empties the pool at once and loads the new one', async () => {
    const { result, rerender } = renderHook((species: string) => useMovePool(species, 9), { initialProps: 'Garchomp' });
    await waitFor(() => expect(result.current).toContain('Earthquake'), { timeout: 20_000 });
    rerender('Amoonguss');
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toContain('Spore'), { timeout: 20_000 });
    expect(result.current).not.toContain('Earthquake');
  }, 30_000);

  test('an empty species loads nothing', () => {
    const { result } = renderHook(() => useMovePool('', 9));
    expect(result.current).toEqual([]);
  });
});

/** The pool follows the game's format. The oracles are the mod's own Dex and the team editor's reader `getMovePool`, never a move name. */
describe('useMovePool follows the format', () => {
  beforeAll(async () => {
    await loadSimMods('gen9championsou');
  });

  // Singles (Champions OU) and doubles (Champions VGC) both.
  describe.each(['gen9championsou', 'gen9championsvgc2026regmcbo3'])('%s', format => {
    test('the pool is the mod\'s, and lacks a move the Generation 9 pool has', async () => {
      const species = 'Garchomp';
      const modPool = (await Dex.mod('champions').learnsets.get('garchomp')).learnset ?? {};
      const modMoves = new Set(Object.keys(modPool).map(id => Dex.mod('champions').moves.get(id).name));
      const standard = await getMovePool(species, 9);
      const missing = standard.filter(name => !modMoves.has(name));
      expect(missing.length).toBeGreaterThan(0);

      const { result } = renderHook(() => useMovePool(species, 9, format));
      const expected = await getMovePool(species, 9, format);
      await waitFor(() => expect(result.current).toEqual(expected), { timeout: 20_000 });
      for (const name of missing) expect(result.current).not.toContain(name);
    }, 30_000);
  });

  // A National Dex draft (singles) and a doubles draft league: the simulator's pool of a Past species.
  describe.each(['gen9natdexdraft', 'gen9doublesdraftleague'])('%s', format => {
    test('Dracovish is offered Fishious Rend, and only with the format', async () => {
      const { result, rerender } = renderHook((id: string) => useMovePool('Dracovish', 9, id), { initialProps: format });
      await waitFor(() => expect(result.current).toContain('Fishious Rend'), { timeout: 20_000 });
      expect(result.current).toEqual(await getMovePool('Dracovish', 9, format));
      rerender('gen9ou');
      expect(result.current).toEqual([]);
      await waitFor(() => expect(result.current.length).toBeGreaterThan(0), { timeout: 20_000 });
      expect(result.current).not.toContain('Fishious Rend');
    }, 30_000);
  });
});

const STATS = { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 0 };

function set(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs: STATS,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '', ...extra,
  };
}

function battle(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const created = new Battle({ formatid: toID(format), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (created.sides.some(side => side.requestState === 'teampreview')) {
    created.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    created.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return created;
}

const walls = [set('Snorlax', ['Splash']), set('Blissey', ['Splash'])];

const SCENES: { kind: BranchMoveModifier; format: string; p1: PokemonSet[] }[] = [
  { kind: 'terastallize', format: 'gen9doublescustomgame', p1: [
    set('Garchomp', ['Dragon Claw'], { teraType: 'Ground' }), set('Incineroar', ['Flare Blitz'], { teraType: 'Fire' })] },
  { kind: 'mega', format: 'gen7doublescustomgame', p1: [
    set('Gengar', ['Shadow Ball'], { item: 'Gengarite' }), set('Lopunny', ['Return'], { item: 'Lopunnite' })] },
  { kind: 'zmove', format: 'gen7doublescustomgame', p1: [
    set('Garchomp', ['Dragon Claw'], { item: 'Dragonium Z' }), set('Charizard', ['Flamethrower'], { item: 'Firium Z' })] },
  { kind: 'ultra', format: 'gen7doublescustomgame', p1: [
    set('Necrozma-Dusk-Mane', ['Sunsteel Strike'], { item: 'Ultranecrozium Z' }), set('Necrozma-Dawn-Wings', ['Moongeist Beam'], { item: 'Ultranecrozium Z' })] },
];

/** The command the picker sends for P1: each slot's first move into the first foe, with the slot's gimmick toggle. */
function commandFor(current: Battle, state: BranchSimState, gimmicks: { modifier: BranchMoveModifier | null; modifierAvailable: boolean }[]) {
  const choices: BranchSlotChoice[] = state.p1MovesBySlot.map((moves, slot) => moveChoiceFor(moves[0], moves[0].targetOptions[0]?.targetLoc, {
    ...gimmicks[slot], moves, modifiers: state.p1ModifiersBySlot[slot],
  }));
  const resolved = resolveSideChoices(current as never, 'p1', choices, requiredChoicesForActiveSlots(state.p1ActiveSlots, state.p1ForceSwitches));
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.command;
}

describe('a side arms each gimmick once, as the simulator takes it (T124 point 1)', () => {
  for (const { kind, format, p1 } of SCENES) {
    test(`${kind}: the simulator rejects it on both slots and accepts the command the panel builds`, () => {
      const state = createBranchStateFromBattle(battle(format, p1, walls) as never, [], {});
      const armedBoth = commandFor(battle(format, p1, walls), state, [0, 1].map(() => ({ modifier: kind, modifierAvailable: true })));
      const twice = battle(format, p1, walls);
      expect(twice.choose('p1', armedBoth), armedBoth).toBe(false);
      expect(twice.sides[0].choice.error).toMatch(/once per battle/);

      const hook = renderHook(() => useGimmickToggles(state.p1ModifiersBySlot, state.p2ModifiersBySlot, 'k'));
      act(() => hook.result.current.gimmickFor('p1', 0).toggle(kind));
      act(() => hook.result.current.gimmickFor('p1', 1).toggle(kind));
      const panel = commandFor(battle(format, p1, walls), state, [0, 1].map(slot => hook.result.current.gimmickFor('p1', slot)));
      expect(battle(format, p1, walls).choose('p1', panel), panel).toBe(true);
      expect(hook.result.current.gimmickFor('p1', 0).modifier).toBe(kind);
    });
  }

  test('singles: the one active is never blocked, and its Tera command is taken', () => {
    const p1 = [set('Garchomp', ['Dragon Claw'], { teraType: 'Ground' })];
    const state = createBranchStateFromBattle(battle('gen9customgame', p1, [walls[0]]) as never, [], {});
    const hook = renderHook(() => useGimmickToggles(state.p1ModifiersBySlot, state.p2ModifiersBySlot, 'k'));
    act(() => hook.result.current.gimmickFor('p1', 0).toggle('terastallize'));
    const gimmick = hook.result.current.gimmickFor('p1', 0);
    expect(gimmick).toMatchObject({ modifier: 'terastallize', modifierAvailable: true });
    const choice = moveChoiceFor(state.p1MovesBySlot[0][0], undefined, { ...gimmick, moves: state.p1MovesBySlot[0], modifiers: state.p1ModifiersBySlot[0] });
    const current = battle('gen9customgame', p1, [walls[0]]);
    const resolved = resolveSideChoices(current as never, 'p1', [choice], [true]);
    expect(resolved).toEqual({ ok: true, command: 'move 1 terastallize' });
    expect(current.choose('p1', 'move 1 terastallize')).toBe(true);
  });
});
