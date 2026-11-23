import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { twinBattle } from '../sim-ask/index.ts';
import { bodyOf, type SimBody } from './body.ts';

/**
 * The body a Tera click makes, asked from the simulator: its terastallize changes some formes by species name with no Dex field to read
 * (Ogerpon into its -Tera forme, whose Embody Aspect raises a stage; Terapagos-Terastal into Terapagos-Stellar with its own HP), and
 * Terapagos-Stellar's Teraform Zero clears weather and terrain (onAfterTerastallization), which the calc does only for a holder with
 * abilityOn. The click runs on a one-Pokémon battle of the body; an already clicked Ogerpon-*-Tera would get its Embody stage twice.
 */

type Clicked = Pick<SimBody, 'species' | 'ability' | 'abilityId' | 'boosts' | 'hp' | 'maxhp'>;

/** The weather and terrain a click goes into (sim ids; empty or absent for none). */
export interface ClickField { weather?: string; terrain?: string }

const changesForme = new Map<string, boolean>();
const clearsFieldMemo = new Map<string, boolean>();
const clickedBodies = new Map<string, Clicked>();

const FOE: PokemonSet = {
  name: 'Foe', species: 'Mew', item: '', ability: 'No Ability', moves: ['splash'], nature: 'Hardy',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
};

/** A one-Pokémon battle of the body (its stages and HP as they stand), or null when it cannot be built (a species this gen lacks). */
function twinOf(gen: number, body: SimBody): { twin: Battle; mon: Pokemon } | null {
  const set: PokemonSet = {
    name: body.species, species: body.species, item: body.item, ability: body.ability, moves: ['splash'],
    nature: body.nature || 'Hardy', evs: { ...FOE.evs, ...body.evs }, ivs: { ...FOE.ivs, ...body.ivs }, level: body.level,
    gender: body.gender ?? '', teraType: body.tera ?? undefined,
  };
  try {
    const twin = twinBattle(`gen${gen}customgame`, { p1: { name: 'Body', team: [set] }, p2: { name: 'Foe', team: [FOE] } });
    const mon = twin.sides[0].active[0];
    Object.assign(mon.boosts, body.boosts);
    mon.hp = body.hp;
    return { twin, mon };
  } catch {
    return null;
  }
}

function clickOnTwin(gen: number, body: SimBody): Clicked | null {
  const made = twinOf(gen, body);
  if (!made) return null;
  const { twin, mon } = made;
  try {
    twin.actions.terastallize(mon);
    const { atk, def, spa, spd, spe } = mon.boosts;
    return {
      species: mon.species.name, ability: twin.dex.abilities.get(mon.ability).name, abilityId: mon.ability,
      boosts: { atk, def, spa, spd, spe }, hp: mon.hp, maxhp: mon.maxhp,
    };
  } catch {
    return null;
  }
}

function clearsOnTwin(gen: number, body: SimBody, field: ClickField): boolean {
  const made = twinOf(gen, body);
  if (!made) return false;
  const { twin, mon } = made;
  try {
    if (field.weather) twin.field.setWeather(field.weather, 'debug');
    if (field.terrain) twin.field.setTerrain(field.terrain, 'debug');
    const stood = !!(twin.field.weather || twin.field.terrain);
    twin.actions.terastallize(mon);
    return stood && !twin.field.weather && !twin.field.terrain;
  } catch {
    return false;
  }
}

/** A battle's Pokémon as an option that clicks its Tera finds it: the body the click makes, or as it stands when the option does not click. */
export function bodyAsClicked(battle: Battle, mon: Pokemon, clicks: boolean): SimBody {
  const body = bodyOf(battle, mon);
  return clicks && !mon.terastallized && mon.teraType
    ? teraClicked(battle.gen, { ...body, tera: mon.teraType }, { weather: battle.field.weather, terrain: battle.field.terrain })
    : body;
}

/** The body after the Tera click on its `tera` type, as the simulator makes it when the forme changes, else the same body; a click that clears `field` marks it abilityOn. */
export function teraClicked<T extends SimBody>(gen: number, body: T, field: ClickField = {}): T {
  if (!body.tera || gen < 9) return body;
  const formeKey = `${gen}|${body.species}|${body.tera}`;
  let changes = changesForme.get(formeKey);
  if (changes === undefined) {
    const clicked = clickOnTwin(gen, body);
    changes = !!clicked && clicked.species !== body.species;
    changesForme.set(formeKey, changes);
  }
  if (!changes) return body;
  const key = JSON.stringify(body);
  let after = clickedBodies.get(key);
  if (!after) {
    const clicked = clickOnTwin(gen, body);
    if (!clicked) return body;
    after = clicked;
    clickedBodies.set(key, after);
  }
  return { ...body, ...after, ...(clearsField(gen, body, field) ? { abilityOn: true } : {}) };
}

/** Memoised per gen, species, Tera type and field: does the click clear the field that stands? */
function clearsField(gen: number, body: SimBody, field: ClickField): boolean {
  if (!field.weather && !field.terrain) return false;
  const key = `${gen}|${body.species}|${body.tera}|${field.weather ?? ''}|${field.terrain ?? ''}`;
  let clears = clearsFieldMemo.get(key);
  if (clears === undefined) {
    clears = clearsOnTwin(gen, body, field);
    clearsFieldMemo.set(key, clears);
  }
  return clears;
}
