import { test, expect } from '@playwright/test';
import { calcSingleDamageRange } from '../src/lib/damage-calc';
import type { SimPokemonInfo, BranchMoveOption } from '../src/lib/branch-engine';

function mon(overrides: Partial<SimPokemonInfo> & { species: string }): SimPokemonInfo {
  return {
    name: overrides.species,
    hp: 300,
    maxhp: 300,
    hpPercent: 100,
    status: '',
    fainted: false,
    isActive: true,
    activeSlot: 0,
    moves: [],
    ability: '',
    item: '',
    stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    gender: '',
    teraType: '',
    boosts: {},
    level: 100,
    ...overrides,
  };
}

function move(name: string, type: string): BranchMoveOption {
  return {
    name,
    activeSlot: 0,
    slot: 1,
    pp: 16,
    maxpp: 16,
    disabled: false,
    type,
    targetType: 'normal',
    requiresTarget: false,
    targetOptions: [],
  };
}

test.describe('damage calc follows the replay generation (B5)', () => {
  test('gen 3 Explosion halves defense while gen 9 does not', () => {
    const registeel = mon({ species: 'Registeel', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 }, nature: 'Adamant' });
    const swampert = mon({ species: 'Swampert', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 } });

    const gen9 = calcSingleDamageRange(registeel, swampert, move('Explosion', 'Normal'), { gen: 9 });
    const gen3 = calcSingleDamageRange(registeel, swampert, move('Explosion', 'Normal'), { gen: 3 });

    expect(gen9.maxPercent).toBeGreaterThan(0);
    // Gen 3 Explosion halves the target's defense — roughly double damage.
    expect(gen3.maxPercent).toBeGreaterThan(gen9.maxPercent * 1.7);
  });

  test('gen 3 Dragon Claw is special (physical/special split by type)', () => {
    const salamence = mon({ species: 'Salamence', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Adamant' });
    const swampert = mon({ species: 'Swampert', evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });

    const gen9 = calcSingleDamageRange(salamence, swampert, move('Dragon Claw', 'Dragon'), { gen: 9 });
    const gen3 = calcSingleDamageRange(salamence, swampert, move('Dragon Claw', 'Dragon'), { gen: 3 });

    // Attack-invested Salamence: physical gen 9 hits much harder than special gen 3.
    expect(gen3.maxPercent).toBeGreaterThan(0);
    expect(gen3.maxPercent).toBeLessThan(gen9.maxPercent);
  });
});

test.describe('damage calc applies the sim set modifiers (B6)', () => {
  test('Technician boosts low-power moves by 1.5x', () => {
    const base = { species: 'Scizor', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Adamant' } as const;
    const garchomp = mon({ species: 'Garchomp' });

    const withTechnician = calcSingleDamageRange(mon({ ...base, ability: 'Technician' }), garchomp, move('Bullet Punch', 'Steel'), {});
    const withoutTechnician = calcSingleDamageRange(mon({ ...base, ability: 'Light Metal' }), garchomp, move('Bullet Punch', 'Steel'), {});

    expect(withTechnician.maxPercent / withoutTechnician.maxPercent).toBeGreaterThan(1.4);
  });

  test('Life Orb boosts damage by 1.3x', () => {
    const base = { species: 'Hydreigon', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, nature: 'Timid' } as const;
    const froslass = mon({ species: 'Froslass' });

    const withOrb = calcSingleDamageRange(mon({ ...base, item: 'Life Orb' }), froslass, move('Dark Pulse', 'Dark'), {});
    const withoutOrb = calcSingleDamageRange(mon({ ...base }), froslass, move('Dark Pulse', 'Dark'), {});

    expect(withOrb.maxPercent / withoutOrb.maxPercent).toBeGreaterThan(1.25);
  });
});

test.describe('damage calc respects field conditions', () => {
  test('Reflect halves physical damage on the defender side', () => {
    const garchomp = mon({ species: 'Garchomp', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Jolly' });
    const tyranitar = mon({ species: 'Tyranitar' });

    const noScreen = calcSingleDamageRange(garchomp, tyranitar, move('Earthquake', 'Ground'), {});
    const withReflect = calcSingleDamageRange(garchomp, tyranitar, move('Earthquake', 'Ground'), {
      defenderSideConditions: ['reflect'],
    });

    expect(withReflect.maxPercent).toBeLessThan(noScreen.maxPercent * 0.6);
  });

  test('rain boosts water moves', () => {
    const pelipper = mon({ species: 'Pelipper', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, nature: 'Modest' });
    const garchomp = mon({ species: 'Garchomp' });

    const clear = calcSingleDamageRange(pelipper, garchomp, move('Hydro Pump', 'Water'), {});
    const rain = calcSingleDamageRange(pelipper, garchomp, move('Hydro Pump', 'Water'), { weather: 'raindance' });

    expect(rain.maxPercent / clear.maxPercent).toBeGreaterThan(1.4);
  });
});
