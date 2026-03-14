/**
 * Common competitive sets for Pokémon.
 * Used to fill in unknown opponent information with reasonable defaults.
 * Sourced from Smogon usage stats / common Draft meta sets.
 */

interface CommonSetInfo {
  ability: string;
  item: string;
  moves: string[];
  nature: string;
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

const COMMON_SETS: Record<string, CommonSetInfo> = {
  // OU staples
  'Dragapult': { ability: 'Infiltrator', item: 'Choice Specs', moves: ['Shadow Ball', 'Draco Meteor', 'Flamethrower', 'U-turn'], nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } },
  'Gholdengo': { ability: 'Good as Gold', item: 'Air Balloon', moves: ['Shadow Ball', 'Make It Rain', 'Recover', 'Nasty Plot'], nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } },
  'Great Tusk': { ability: 'Protosynthesis', item: 'Booster Energy', moves: ['Headlong Rush', 'Close Combat', 'Ice Spinner', 'Rapid Spin'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } },
  'Kingambit': { ability: 'Supreme Overlord', item: 'Leftovers', moves: ['Kowtow Cleave', 'Iron Head', 'Sucker Punch', 'Swords Dance'], nature: 'Adamant', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 } },
  'Iron Valiant': { ability: 'Quark Drive', item: 'Booster Energy', moves: ['Moonblast', 'Close Combat', 'Knock Off', 'Swords Dance'], nature: 'Naive', evs: { hp: 0, atk: 252, def: 0, spa: 4, spd: 0, spe: 252 } },
  'Garganacl': { ability: 'Purifying Salt', item: 'Leftovers', moves: ['Salt Cure', 'Recover', 'Stealth Rock', 'Body Press'], nature: 'Impish', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 } },
  'Heatran': { ability: 'Flash Fire', item: 'Leftovers', moves: ['Magma Storm', 'Earth Power', 'Stealth Rock', 'Toxic'], nature: 'Calm', evs: { hp: 252, atk: 0, def: 0, spa: 4, spd: 252, spe: 0 } },
  'Landorus-Therian': { ability: 'Intimidate', item: 'Leftovers', moves: ['Earthquake', 'U-turn', 'Stealth Rock', 'Toxic'], nature: 'Impish', evs: { hp: 252, atk: 0, def: 240, spa: 0, spd: 16, spe: 0 } },
  'Toxapex': { ability: 'Regenerator', item: 'Rocky Helmet', moves: ['Scald', 'Recover', 'Toxic Spikes', 'Haze'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 } },
  'Clefable': { ability: 'Magic Guard', item: 'Life Orb', moves: ['Moonblast', 'Flamethrower', 'Calm Mind', 'Soft-Boiled'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 160, spa: 96, spd: 0, spe: 0 } },
  'Corviknight': { ability: 'Pressure', item: 'Leftovers', moves: ['Brave Bird', 'Body Press', 'Defog', 'Roost'], nature: 'Impish', evs: { hp: 252, atk: 0, def: 168, spa: 0, spd: 88, spe: 0 } },
  'Gliscor': { ability: 'Poison Heal', item: 'Toxic Orb', moves: ['Earthquake', 'Protect', 'Toxic', 'Spikes'], nature: 'Careful', evs: { hp: 244, atk: 0, def: 36, spa: 0, spd: 228, spe: 0 } },
  'Metagross': { ability: 'Clear Body', item: 'Choice Scarf', moves: ['Meteor Mash', 'Earthquake', 'Ice Punch', 'Explosion'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Azumarill': { ability: 'Huge Power', item: 'Sitrus Berry', moves: ['Aqua Jet', 'Play Rough', 'Belly Drum', 'Knock Off'], nature: 'Adamant', evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 } },
  'Kleavor': { ability: 'Sharpness', item: 'Heavy-Duty Boots', moves: ['Stone Axe', 'X-Scissor', 'Close Combat', 'Swords Dance'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Decidueye': { ability: 'Overgrow', item: 'Heavy-Duty Boots', moves: ['Shadow Ball', 'Giga Drain', 'Nasty Plot', 'Roost'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 } },
  'Terapagos': { ability: 'Tera Shift', item: 'Heavy-Duty Boots', moves: ['Flamethrower', 'Earth Power', 'Ice Beam', 'Rapid Spin'], nature: 'Modest', evs: { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 } },

  // Common picks
  'Scizor': { ability: 'Technician', item: 'Heavy-Duty Boots', moves: ['Bullet Punch', 'U-turn', 'Swords Dance', 'Knock Off'], nature: 'Adamant', evs: { hp: 248, atk: 252, def: 0, spa: 0, spd: 8, spe: 0 } },
  'Ting-Lu': { ability: 'Vessel of Ruin', item: 'Leftovers', moves: ['Earthquake', 'Spikes', 'Whirlwind', 'Ruination'], nature: 'Careful', evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 } },
  'Ninetales-Alola': { ability: 'Snow Warning', item: 'Light Clay', moves: ['Aurora Veil', 'Blizzard', 'Moonblast', 'Freeze-Dry'], nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } },
  'Amoonguss': { ability: 'Regenerator', item: 'Rocky Helmet', moves: ['Spore', 'Giga Drain', 'Sludge Bomb', 'Clear Smog'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 } },
  'Thundurus-Therian': { ability: 'Volt Absorb', item: 'Choice Specs', moves: ['Thunderbolt', 'Volt Switch', 'Focus Blast', 'Grass Knot'], nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } },
  'Torkoal': { ability: 'Drought', item: 'Heat Rock', moves: ['Lava Plume', 'Stealth Rock', 'Rapid Spin', 'Yawn'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 } },
  'Weavile': { ability: 'Pressure', item: 'Heavy-Duty Boots', moves: ['Triple Axel', 'Knock Off', 'Ice Shard', 'Swords Dance'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Volcarona': { ability: 'Flame Body', item: 'Heavy-Duty Boots', moves: ['Quiver Dance', 'Flamethrower', 'Bug Buzz', 'Giga Drain'], nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } },
  'Tyranitar': { ability: 'Sand Stream', item: 'Leftovers', moves: ['Stone Edge', 'Crunch', 'Earthquake', 'Stealth Rock'], nature: 'Adamant', evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 } },
  'Ferrothorn': { ability: 'Iron Barbs', item: 'Leftovers', moves: ['Spikes', 'Leech Seed', 'Power Whip', 'Knock Off'], nature: 'Impish', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 } },
  'Rotom-Wash': { ability: 'Levitate', item: 'Leftovers', moves: ['Volt Switch', 'Hydro Pump', 'Will-O-Wisp', 'Pain Split'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 200, spa: 0, spd: 56, spe: 0 } },
  'Slowking-Galar': { ability: 'Regenerator', item: 'Assault Vest', moves: ['Future Sight', 'Sludge Bomb', 'Flamethrower', 'Scald'], nature: 'Calm', evs: { hp: 252, atk: 0, def: 0, spa: 4, spd: 252, spe: 0 } },
  'Rillaboom': { ability: 'Grassy Surge', item: 'Choice Band', moves: ['Grassy Glide', 'Wood Hammer', 'Knock Off', 'U-turn'], nature: 'Adamant', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Cinderace': { ability: 'Libero', item: 'Heavy-Duty Boots', moves: ['Pyro Ball', 'High Jump Kick', 'U-turn', 'Sucker Punch'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Urshifu-Rapid-Strike': { ability: 'Unseen Fist', item: 'Choice Band', moves: ['Surging Strikes', 'Close Combat', 'Aqua Jet', 'U-turn'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Urshifu': { ability: 'Unseen Fist', item: 'Choice Band', moves: ['Wicked Blow', 'Close Combat', 'Sucker Punch', 'U-turn'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Dragonite': { ability: 'Multiscale', item: 'Heavy-Duty Boots', moves: ['Dragon Dance', 'Dual Wingbeat', 'Earthquake', 'Roost'], nature: 'Adamant', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Garchomp': { ability: 'Rough Skin', item: 'Rocky Helmet', moves: ['Earthquake', 'Dragon Claw', 'Stealth Rock', 'Swords Dance'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
  'Skeledirge': { ability: 'Unaware', item: 'Heavy-Duty Boots', moves: ['Torch Song', 'Shadow Ball', 'Slack Off', 'Will-O-Wisp'], nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 } },
  'Iron Moth': { ability: 'Quark Drive', item: 'Booster Energy', moves: ['Fiery Dance', 'Energy Ball', 'Psychic', 'Sludge Wave'], nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 } },
  'Samurott-Hisui': { ability: 'Sharpness', item: 'Focus Sash', moves: ['Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Sacred Sword'], nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } },
};

/**
 * Get the common competitive set for a species, or undefined if not found.
 */
export function getCommonSet(species: string): CommonSetInfo | undefined {
  return COMMON_SETS[species];
}

/**
 * Get a default ability for a species.
 */
export function getDefaultAbility(species: string): string {
  return COMMON_SETS[species]?.ability || '';
}

/**
 * Get a default item for a species.
 */
export function getDefaultItem(species: string): string {
  return COMMON_SETS[species]?.item || '';
}

/**
 * Get default moves for a species (fills up to 4, keeping any already-known moves).
 */
export function fillDefaultMoves(species: string, knownMoves: string[]): string[] {
  const set = COMMON_SETS[species];
  if (!set) return knownMoves;

  const result = [...knownMoves];
  for (const move of set.moves) {
    if (result.length >= 4) break;
    if (!result.some(m => m.toLowerCase() === move.toLowerCase())) {
      result.push(move);
    }
  }
  return result;
}
