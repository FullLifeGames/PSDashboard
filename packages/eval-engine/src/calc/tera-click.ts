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
 */

type Clicked = Pick<SimBody, 'species' | 'ability' | 'abilityId' | 'boosts' | 'hp' | 'maxhp'>;

const changesForme = new Map<string, boolean>();
const clickedBodies = new Map<string, Clicked>();

const FOE: PokemonSet = {
  name: 'Foe', species: 'Mew', item: '', ability: 'No Ability', moves: ['splash'], nature: 'Hardy',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '',
};

/** The simulator's click on a twin of the body, or null when the twin cannot be built (a species this gen lacks). */
function clickOnTwin(gen: number, body: SimBody): Clicked | null {
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

/**
 * A battle's Pokémon as an option that clicks its Tera finds it (T84): the
 * body the click makes, from the simulator; as it stands when the option
 * does not click, or the body clicked before or has no Tera type.
 */
export function bodyAsClicked(battle: Battle, mon: Pokemon, clicks: boolean): SimBody {
  const body = bodyOf(battle, mon);
  return clicks && !mon.terastallized && mon.teraType ? teraClicked(battle.gen, { ...body, tera: mon.teraType }) : body;
}

/** The body after the Tera click on its `tera` type: as the simulator makes it when the forme changes, else the same body. */
export function teraClicked<T extends SimBody>(gen: number, body: T): T {
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
  return { ...body, ...after };
}
