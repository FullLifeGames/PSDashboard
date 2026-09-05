import type {
  BranchMoveOption, BranchSimState, BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, SimPokemonInfo,
} from '@fulllifegames/eval-engine';

export type FormatKind = 'singles' | 'doubles';

const STATS = { atk: 200, def: 150, spa: 120, spd: 140, spe: 180 };

/** A living team member; `active` places it in a slot. */
export function pokemon(species: string, overrides: Partial<SimPokemonInfo> = {}): SimPokemonInfo {
  return {
    name: species, species, hp: 300, maxhp: 300, hpPercent: 100, status: '', fainted: false, isActive: false,
    activeSlot: null, moves: [], ability: 'Pressure', item: 'Leftovers', stats: { ...STATS }, boosts: {}, level: 100,
    types: ['Normal'],
    ...overrides,
  };
}

export function moveOption(name: string, overrides: Partial<BranchMoveOption> = {}): BranchMoveOption {
  return {
    name, activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: 'Normal', targetType: 'normal',
    requiresTarget: false, targetOptions: [],
    ...overrides,
  };
}

export function switchOption(species: string, overrides: Partial<BranchSwitchOption> = {}): BranchSwitchOption {
  return { name: species, species, activeSlot: 0, slot: 2, hp: '300/300', hpPercent: 100, fainted: false, ...overrides };
}

/** A move target as the sim labels it: the slot ("P2A"), then the Pokémon standing there. */
export function targetOption(side: 'p1' | 'p2', activeSlot: number, species: string, targetLoc: number): BranchTargetOption {
  return { label: `${side.toUpperCase()}${String.fromCharCode(65 + activeSlot)}`, targetLoc, side, activeSlot, name: species, species, hpPercent: 100 };
}

export const NO_MODIFIERS: BranchSlotModifiers = { teraType: null, canMegaEvo: false, canUltraBurst: false, zMoves: [] };

const SINGLES = {
  p1: { active: ['Garchomp'], bench: ['Heatran', 'Latias', 'Clefable', 'Weavile', 'Toxapex'] },
  p2: { active: ['Ferrothorn'], bench: ['Rotom-Wash', 'Excadrill', 'Tornadus-Therian', 'Keldeo', 'Medicham'] },
};
const DOUBLES = {
  p1: { active: ['Incineroar', 'Amoonguss'], bench: ['Flutter Mane', 'Urshifu'] },
  p2: { active: ['Rillaboom', 'Tornadus'], bench: ['Kingambit', 'Ogerpon'] },
};

const MOVES: Record<string, [string, string][]> = {
  Garchomp: [['Earthquake', 'Ground'], ['Stone Edge', 'Rock'], ['Swords Dance', 'Normal'], ['Scale Shot', 'Dragon']],
  Ferrothorn: [['Leech Seed', 'Grass'], ['Stealth Rock', 'Rock'], ['Body Press', 'Fighting'], ['Knock Off', 'Dark']],
  Incineroar: [['Fake Out', 'Normal'], ['Flare Blitz', 'Fire'], ['Parting Shot', 'Dark'], ['Protect', 'Normal']],
  Amoonguss: [['Spore', 'Grass'], ['Pollen Puff', 'Bug'], ['Rage Powder', 'Bug'], ['Protect', 'Normal']],
  Rillaboom: [['Fake Out', 'Normal'], ['Wood Hammer', 'Grass'], ['Grassy Glide', 'Grass'], ['U-turn', 'Bug']],
  Tornadus: [['Tailwind', 'Flying'], ['Bleakwind Storm', 'Flying'], ['Taunt', 'Dark'], ['Protect', 'Normal']],
};

function sideState(side: 'p1' | 'p2', kind: FormatKind) {
  const layout = (kind === 'singles' ? SINGLES : DOUBLES)[side];
  const other: 'p1' | 'p2' = side === 'p1' ? 'p2' : 'p1';
  const enemyActive = (kind === 'singles' ? SINGLES : DOUBLES)[other].active;
  const activeSlots = layout.active.map((species, slot) => pokemon(species, {
    isActive: true, activeSlot: slot, moves: (MOVES[species] ?? []).map(([name, type]) => ({ name, type })),
  }));
  const benchMons = layout.bench.map(species => pokemon(species));
  const movesBySlot = activeSlots.map((mon, slot) => (MOVES[mon.species] ?? [['Tackle', 'Normal']]).map(([name, type], index) => {
    // Doubles: single-target attacks name their targets, spread and self moves do not.
    const requiresTarget = kind === 'doubles' && !['Protect', 'Tailwind', 'Rage Powder', 'Swords Dance', 'Stealth Rock', 'Leech Seed'].includes(name);
    return moveOption(name, {
      activeSlot: slot, slot: index + 1, type, requiresTarget,
      targetOptions: requiresTarget
        ? enemyActive.map((species, enemySlot) => targetOption(other, enemySlot, species, enemySlot + 1))
        : [],
    });
  }));
  const switchesBySlot = activeSlots.map((_, slot) => benchMons.map((mon, index) => switchOption(mon.species, {
    activeSlot: slot, slot: layout.active.length + index + 1,
  })));
  return {
    pokemon: [...activeSlots, ...benchMons],
    activeSlots,
    movesBySlot,
    switchesBySlot,
    modifiers: activeSlots.map(() => ({ ...NO_MODIFIERS })),
  };
}

/** A branch position with pickers for both sides, singles (one slot) or doubles (two slots). */
export function simState(kind: FormatKind = 'singles', overrides: Partial<BranchSimState> = {}): BranchSimState {
  const p1 = sideState('p1', kind);
  const p2 = sideState('p2', kind);
  return {
    p1Moves: p1.movesBySlot[0], p1MovesBySlot: p1.movesBySlot,
    p1Switches: p1.switchesBySlot[0], p1SwitchesBySlot: p1.switchesBySlot,
    p2Moves: p2.movesBySlot[0], p2MovesBySlot: p2.movesBySlot,
    p2Switches: p2.switchesBySlot[0], p2SwitchesBySlot: p2.switchesBySlot,
    p1Pokemon: p1.pokemon, p2Pokemon: p2.pokemon,
    p1Active: p1.activeSlots[0], p1ActiveSlots: p1.activeSlots,
    p2Active: p2.activeSlots[0], p2ActiveSlots: p2.activeSlots,
    p1ModifiersBySlot: p1.modifiers, p2ModifiersBySlot: p2.modifiers,
    field: { weather: '', terrain: '', p1SideConditions: [], p2SideConditions: [] },
    log: ['|turn|3'],
    ended: false, winner: null, waitingForChoice: true, turnNumber: 3,
    p1ForceSwitch: false, p1ForceSwitches: p1.activeSlots.map(() => false),
    p2ForceSwitch: false, p2ForceSwitches: p2.activeSlots.map(() => false),
    p1Choice: null, p1Choices: p1.activeSlots.map(() => null),
    p2Choice: null, p2Choices: p2.activeSlots.map(() => null),
    ...overrides,
  };
}
