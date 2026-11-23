import type { ActiveMove, Battle, PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD } from '../calc-gen.ts';
import type { RulesDex } from '../rules-dex.ts';
import { twinBattle } from './twin.ts';

/**
 * The simulator's own answer to "would this ability have refused the effect the log shows landing?", played as a scene on a twin battle
 * (EVALUATION.md, "Rule-outs").
 */

/**
 * One body of a scene: the species and the ability the twin gives it ('' leaves it inert). The target of a hit may carry what the log
 * shows of it (its item, its types now, its volatile conditions: Ingrain and Smack Down ground it).
 */
export interface SceneBody { species: string; ability: string; item?: string; types?: string[]; volatiles?: string[] }

/** What landed: a volatile (flinch, confusion, Taunt, Encore, ...), a major status, a stat drop of one stat, or the damage of a move's hit. */
export interface SceneEffect { kind: 'volatile' | 'status' | 'boost' | 'hit'; id: string; stat?: string }

export interface EffectScene {
  target: SceneBody;
  /** The target's ally on the field in doubles, absent in singles. */
  partner?: SceneBody;
  source: SceneBody;
  effect: SceneEffect;
  /** How the effect reached the target: a status move's own field, a damaging move's secondary, or an ability's call. */
  route: 'primary' | 'secondary' | 'ability';
  /** The move that dealt it (primary and secondary routes), as the log names it. */
  move?: string;
  ability?: string;
  /** The weather standing at that moment (a Dex weather id), '' for none. */
  weather?: string;
  /** The terrain standing (a Dex terrain id) and the pseudo-weathers (Gravity, Magic Room, ...): a hit is played under them. */
  terrain?: string;
  fields?: string[];
}

const body = (entry: SceneBody, moves: string[]): PokemonSet => ({
  name: entry.species, species: entry.species, item: entry.item ?? '', ability: entry.ability, moves, nature: 'Hardy', gender: '', level: 100,
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

const formatOf = (dex: RulesDex, doubles: boolean): string =>
  `gen${dex.gen}${dex.currentMod === CHAMPIONS_MOD ? 'champions' : ''}${doubles ? 'doubles' : ''}customgame`;

// eslint-disable-next-line names/no-new-dex-name -- the twin's warm-up move: any move that does nothing (blocked-effects-sweep.spec.ts plays the same scenes through whole battles)
const NO_MOVE = 'splash';

function twinOf(dex: RulesDex, scene: EffectScene): Battle {
  const doubles = !!scene.partner;
  const hit = scene.effect.kind === 'hit';
  const filler = { species: scene.source.species, ability: '' };
  const sourceMoves = hit ? [scene.move ?? NO_MOVE] : [NO_MOVE];
  const p1 = doubles ? [body(scene.source, sourceMoves), body(filler, [NO_MOVE])] : [body(scene.source, sourceMoves)];
  const p2 = doubles ? [body(scene.target, [NO_MOVE]), body(scene.partner!, [NO_MOVE])] : [body(scene.target, [NO_MOVE])];
  const battle = twinBattle(formatOf(dex, doubles), { p1: { name: 'Source', team: p1 }, p2: { name: 'Target', team: p2 } });
  // One turn of Splash, so that the bodies have moved: an effect that reads the target's last move (Encore, Disable) asks for it.
  // A hit is played on the first turn, as the moves of the first turn (Fake Out) need.
  if (!hit) {
    const choice = doubles ? 'move 1, move 1' : 'move 1';
    battle.makeChoices(choice, choice);
  }
  return battle;
}

/** The secondary a move's data would carry for the effect, as the simulator's own secondary filter reads it. */
function secondaryOf(effect: SceneEffect): Record<string, unknown> {
  if (effect.kind === 'volatile') return { chance: 100, volatileStatus: effect.id };
  if (effect.kind === 'status') return { chance: 100, status: effect.id };
  return { chance: 100, boosts: { [effect.stat ?? 'atk']: -1 } };
}

/** Whether the effect gets past what stands before it on its route: the secondary filter (Shield Dust), `TryHit` of a status move. */
function reaches(battle: Battle, scene: EffectScene, move: ActiveMove | null): boolean {
  const source = battle.p1.active[0];
  const target = battle.p2.active[0];
  if (scene.route === 'secondary') return (battle.runEvent('ModifySecondaries', target, source, move, [secondaryOf(scene.effect)]) as unknown[]).length > 0;
  return !(scene.route === 'primary' && move?.category === 'Status') || !!battle.runEvent('TryHit', target, source, move);
}

function play(dex: RulesDex, scene: EffectScene): boolean {
  if (scene.effect.kind === 'hit') return hitLands(dex, scene);
  const battle = twinOf(dex, scene);
  const source = battle.p1.active[0];
  const target = battle.p2.active[0];
  const move = scene.route === 'ability' ? null : battle.dex.getActiveMove(scene.move ?? NO_MOVE);
  battle.activePokemon = source;
  battle.activeMove = move;
  if (scene.weather) battle.field.setWeather(scene.weather, source);
  // ModifyMove first: a Mold Breaker kin sets `ignoreAbility` there, and the battle's own `suppressingAbility` then skips the breakable handlers.
  if (move) battle.runEvent('ModifyMove', source, target, move, move);
  if (!reaches(battle, scene, move)) return false;
  const { kind, id, stat } = scene.effect;
  if (kind === 'volatile') return !!target.addVolatile(id, source, move);
  if (kind === 'status') return !!target.trySetStatus(id, source, move);
  const cause = move ?? battle.dex.abilities.get(scene.ability ?? '');
  // A drop lands when the battle prints it: Contrary turns it into a rise (`-boost`), and Defiant's answer to a drop that landed comes after it.
  const mark = battle.log.length;
  battle.boost({ [stat ?? 'atk']: -1 }, target, source, cause as never);
  return battle.log.slice(mark).some(line => line.startsWith('|-unboost|p2a: ') && line.split('|')[3] === (stat ?? 'atk'));
}

/**
 * The choice text of the move at the foe in front: the simulator asks for a target only for the moves that pick one (`targetTypeChoices`
 * of the battle's actions, so no list of target types stands here); a move that picks the ally or the user is no hit on a foe.
 */
function aimOf(battle: Battle, move: string, doubles: boolean): string {
  const target = battle.dex.moves.get(move).target;
  return doubles && battle.actions.targetTypeChoices(target) && !target.startsWith('adjacentAlly') ? ' 1' : '';
}

/**
 * The field the log shows (weather, terrain, Gravity and the other pseudo-weathers) stands before the move. A field the twin cannot stand
 * under (a condition it refuses to start) is a scene it cannot play: the caller then rules nothing out. A field that already stands (an
 * ability of the twin's own bodies sets it on entry) is the field of the scene.
 */
function standUnderField(battle: Battle, scene: EffectScene) {
  const source = battle.p1.active[0];
  if (scene.weather) battle.field.setWeather(scene.weather, source);
  if (scene.terrain) battle.field.setTerrain(scene.terrain, source);
  for (const id of scene.fields ?? []) battle.field.addPseudoWeather(id, source);
  const standing = (scene.weather ? battle.field.isWeather(scene.weather) : true) && (scene.terrain ? battle.field.isTerrain(scene.terrain) : true)
    && (scene.fields ?? []).every(id => !!battle.field.pseudoWeather[id]);
  if (!standing) throw new Error('the twin cannot stand under the field of the scene');
}

/** The target has the types now and the volatile conditions the client knows (the item is in its set already). */
function giveTargetState(battle: Battle, scene: EffectScene) {
  const source = battle.p1.active[0];
  const target = battle.p2.active[0];
  if (scene.target.types?.length) target.setType(scene.target.types as never);
  for (const id of scene.target.volatiles ?? []) {
    if (!battle.dex.conditions.get(id).exists) continue;
    if (!target.addVolatile(id, source) && !target.volatiles[id]) throw new Error(`the twin cannot give ${id}`);
  }
}

/**
 * Plays the move on the twin through the simulator's own turn (its `ModifyMove`, `ModifyType`, `RedirectTarget`, `TryHit`, immunity and
 * `onFoeTryMove` steps, whatever the generation's mod changes) with the dice forced to their lucky side, so that a miss never reads as a
 * refusal, and answers whether the log shows the damage of the hit on the target: the line the reader looked at, `|-damage|` without `[from]`.
 * A body that transforms (Imposter copies the foe on entry) plays another battle than the one the log shows, so the scene answers null.
 */
function hitLands(dex: RulesDex, scene: EffectScene): boolean {
  const battle = twinOf(dex, scene);
  const doubles = !!scene.partner;
  standUnderField(battle, scene);
  giveTargetState(battle, scene);
  battle.randomChance = () => true;
  // The log shows the hit before the target's own action of that turn (an action before it shows as a line of its own): the target does not act on the twin,
  // or Protean and Libero would change its type with the move it uses first.
  battle.onEvent('BeforeMove', battle.format, (pokemon: { side: unknown }) => (pokemon.side === battle.p2 ? false : undefined));
  const mark = battle.log.length;
  const move = scene.move ?? NO_MOVE;
  battle.makeChoices(doubles ? `move 1${aimOf(battle, move, doubles)}, move 1` : 'move 1', doubles ? 'move 1, move 1' : 'move 1');
  if (battle.log.some(line => line.startsWith('|-transform|'))) throw new Error('a transform plays another battle');
  return battle.log.slice(mark).some(line => line.startsWith('|-damage|p2a: ') && !line.includes('[from]'));
}

const memoByDex = new WeakMap<RulesDex, Map<string, boolean | null>>();

/** Twin battles played so far in this process, memo hits not counted (the cost probe and the specs read it). */
let plays = 0;
export const twinPlays = (): number => plays;

function remembered(dex: RulesDex, key: string, ask: () => boolean | null): boolean | null {
  const memo = memoByDex.get(dex) ?? new Map<string, boolean | null>();
  memoByDex.set(dex, memo);
  if (!memo.has(key)) memo.set(key, ask());
  return memo.get(key)!;
}

/**
 * Whether the effect lands in the scene: true when the simulator lets it through, false when a handler refuses it, null when the
 * scene cannot be played (a species or move the generation lacks, a handler that throws): the caller then rules nothing out.
 */
export function effectLands(dex: RulesDex, scene: EffectScene): boolean | null {
  return remembered(dex, JSON.stringify(scene), () => {
    plays++;
    try {
      return play(dex, scene);
    } catch {
      return null;
    }
  });
}

/**
 * The handlers of an ability that run in the steps of a hit, as the simulator names them (the `onAlly`, `onFoe`, `onAny` and `onSource` twins of a
 * target's own events included): `TryHit` and `TryHitSide` (the absorbers, Wonder Guard, the category guards), `TryMove` (the priority guards, Damp),
 * `RedirectTarget` (Lightning Rod, Storm Drain), `TryPrimaryHit`, `Damage` (Disguise, Ice Face, Sturdy) and `Effectiveness`. `Immunity` is left out: the
 * simulator runs it for powder, statuses and weather damage, and no damaging move of any generation is a powder move (landed-hit-sweep.spec.ts holds that).
 * The sweep holds the list to the Dex: no ability the twin refuses a hit with in any realm may fall outside `mayRefuseHit`.
 */
const HIT_HANDLER = /^on(Ally|Foe|Any|Source)?(TryHit|TryHitSide|TryMove|RedirectTarget|TryPrimaryHit|Damage|Effectiveness)(Priority|Order|SubOrder)?$/;
/** An ability that reacts to the weather or the terrain may change the body's types under it (Forecast, Mimicry): asked of the simulator under each. */
const FIELD_HANDLER = /^on(Weather|Terrain)Change(Priority|Order|SubOrder)?$/;

/**
 * Whether a body with the ability on the field can change what stands in a hit's way with no handler of a hit's steps: it grounds or lifts the body
 * (Levitate: the simulator reads it inside `isGrounded`, no handler), it starts a weather, a terrain or a pseudo-weather when it enters (Psychic Surge
 * stops a priority move), or it changes the body's types, at entry or under a weather or terrain when it reacts to one. Asked of the simulator on a bare
 * twin, once per ability.
 */
function changesTheScene(dex: RulesDex, ability: string, reactsToField: boolean): boolean | null {
  try {
    // A species that can hold the ability (a forme-changing ability reads the species), a grounded one first (a Flying body shows no Levitate).
    const standard = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
    const holders = standard.filter(entry => Object.values(entry.abilities).includes(ability));
    const species = (holders.find(entry => !entry.types.includes('Flying')) ?? holders[0] ?? standard.find(entry => !entry.types.includes('Flying'))!).name;
    const battle = twinBattle(formatOf(dex, false), {
      p1: { name: 'Plain', team: [body({ species, ability: '' }, [NO_MOVE])] }, p2: { name: 'Holder', team: [body({ species, ability }, [NO_MOVE])] },
    });
    const plain = battle.p1.active[0];
    const holder = battle.p2.active[0];
    const field = battle.field;
    const typesOf = () => holder.getTypes().join('/');
    if (holder.isGrounded() !== plain.isGrounded() || typesOf() !== plain.getTypes().join('/')) return true;
    if (field.weather || field.terrain || Object.keys(field.pseudoWeather).length > 0) return true;
    if (!reactsToField) return false;
    // The weathers are conditions of their own; the terrains live in the data of the moves that start them.
    const fields = [...Object.keys(dex.data.Conditions), ...dex.moves.all().map(move => move.terrain ?? '')].filter(Boolean);
    return [...new Set(fields)].map(id => dex.conditions.get(id)).some(condition => {
      if (condition.effectType === 'Weather') field.setWeather(condition.id, holder);
      else if (condition.effectType === 'Terrain') field.setTerrain(condition.id, holder);
      else return false;
      const changed = typesOf() !== plain.getTypes().join('/');
      field.clearWeather();
      field.clearTerrain();
      return changed;
    });
  } catch {
    return null;
  }
}

/**
 * Whether an ability could have refused the hit of some move: it has a handler in a hit's steps (`HIT_HANDLER`), or it changes the scene by entering or by
 * what it is (`changesTheScene`). An ability that cannot is no candidate for the hit rule, and the reader asks the simulator nothing about it. An ability
 * the Dex lacks or a probe that cannot be played counts as a candidate.
 */
export function mayRefuseHit(dex: RulesDex, ability: string): boolean {
  const entry = dex.abilities.get(ability);
  if (!entry.exists) return true;
  return remembered(dex, `hitguard|${entry.id}`, () => {
    const keys = Object.keys(entry);
    return keys.some(key => HIT_HANDLER.test(key)) || changesTheScene(dex, entry.name, keys.some(key => FIELD_HANDLER.test(key))) !== false;
  }) !== false;
}
