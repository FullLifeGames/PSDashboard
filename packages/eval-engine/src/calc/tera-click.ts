import { Battle, Teams, toID, type Pokemon, type PokemonSet } from '@pkmn/sim';
import { bodyOf, type SimBody } from './body.ts';

/**
 * Round 67 (T100, T84): the body a Tera click makes, asked from the
 * simulator. Its terastallize (battle-actions) changes some formes on the
 * click, by species name and with no Dex field to read: Ogerpon into its
 * -Tera forme, whose Embody Aspect then raises a stage, and Terapagos-Terastal
 * into Terapagos-Stellar with its own HP. So the click runs on a one-Pokémon
 * battle of the same body, and the body reads what it left: forme, ability,
 * stages and HP. A click that keeps the forme changes the types only (an
 * already clicked Ogerpon-*-Tera would get its Embody stage a second time).
 * Two memos: per species and Tera type whether the click changes the forme
 * at all, then per whole body for the formes that change.
 *
 * Round 69 (T152): Terapagos-Stellar's Teraform Zero clears the weather and
 * the terrain on the click (the simulator's onAfterTerastallization), which
 * the calc does only for a holder with abilityOn. A click into a field that
 * stands is asked of a second twin with that field set, and the body it makes
 * carries abilityOn when the field is gone after the click; nothing else
 * reads the ability's name.
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
    const twin = new Battle({
      formatid: toID(`gen${gen}customgame`), seed: '1,2,3,4',
      p1: { name: 'Body', team: Teams.pack([set]) }, p2: { name: 'Foe', team: Teams.pack([FOE]) },
    });
    if (twin.sides.some(side => side.requestState === 'teampreview')) {
      twin.choose('p1', 'team 1');
      twin.choose('p2', 'team 1');
    }
    const mon = twin.sides[0].active[0];
    // The body as it stands before the click: its stages and HP.
    Object.assign(mon.boosts, body.boosts);
    mon.hp = body.hp;
    return { twin, mon };
  } catch {
    return null;
  }
}

/** The simulator's click on a twin of the body, or null when the twin cannot be built. */
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

/** Does the simulator's click on a twin of the body, standing in this field, leave the weather or the terrain gone? */
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

/**
 * A battle's Pokémon as an option that clicks its Tera finds it (T84): the
 * body the click makes, from the simulator; as it stands when the option
 * does not click, or the body clicked before or has no Tera type.
 */
export function bodyAsClicked(battle: Battle, mon: Pokemon, clicks: boolean): SimBody {
  const body = bodyOf(battle, mon);
  return clicks && !mon.terastallized && mon.teraType
    ? teraClicked(battle.gen, { ...body, tera: mon.teraType }, { weather: battle.field.weather, terrain: battle.field.terrain })
    : body;
}

/**
 * The body after the Tera click on its `tera` type: as the simulator makes it when the forme changes, else the same
 * body. `field` is the weather and terrain the click goes into: a click that clears them marks the body abilityOn.
 */
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

/** One answer per gen, species, Tera type and field: does the click clear the field that stands? */
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
