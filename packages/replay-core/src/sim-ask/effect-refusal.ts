import type { ActiveMove, Battle, PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD } from '../calc-gen.ts';
import type { RulesDex } from '../rules-dex.ts';
import { twinBattle } from './twin.ts';

// Design: EVALUATION.md "Rule-outs".

/** One body of a scene: the species and the ability the twin gives it ('' leaves it inert). */
export interface SceneBody { species: string; ability: string; item?: string; types?: string[]; volatiles?: string[] }

export interface SceneEffect { kind: 'volatile' | 'status' | 'boost' | 'hit'; id: string; stat?: string }

export interface EffectScene {
  target: SceneBody;
  partner?: SceneBody;
  source: SceneBody;
  effect: SceneEffect;
  route: 'primary' | 'secondary' | 'ability';
  move?: string;
  ability?: string;
  /** A Dex weather id, '' for none. */
  weather?: string;
  /** A terrain id, or a pseudo-weather (Gravity, Magic Room): a hit is played under it. */
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
  // One turn of Splash gives the bodies a last move: Encore and Disable read it.
  if (!hit) {
    const choice = doubles ? 'move 1, move 1' : 'move 1';
    battle.makeChoices(choice, choice);
  }
  return battle;
}

function secondaryOf(effect: SceneEffect): Record<string, unknown> {
  if (effect.kind === 'volatile') return { chance: 100, volatileStatus: effect.id };
  if (effect.kind === 'status') return { chance: 100, status: effect.id };
  return { chance: 100, boosts: { [effect.stat ?? 'atk']: -1 } };
}

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
  // ModifyMove first: Mold Breaker kin set `ignoreAbility` there, which `suppressingAbility` then reads.
  if (move) battle.runEvent('ModifyMove', source, target, move, move);
  if (!reaches(battle, scene, move)) return false;
  const { kind, id, stat } = scene.effect;
  if (kind === 'volatile') return !!target.addVolatile(id, source, move);
  if (kind === 'status') return !!target.trySetStatus(id, source, move);
  const cause = move ?? battle.dex.abilities.get(scene.ability ?? '');
  // A drop lands when the log prints it: Contrary makes it a rise, Defiant answers only after a landed drop.
  const mark = battle.log.length;
  battle.boost({ [stat ?? 'atk']: -1 }, target, source, cause as never);
  return battle.log.slice(mark).some(line => line.startsWith('|-unboost|p2a: ') && line.split('|')[3] === (stat ?? 'atk'));
}

// The simulator asks for a target only for moves that pick one (`targetTypeChoices`): no target-type list here.
function aimOf(battle: Battle, move: string, doubles: boolean): string {
  const target = battle.dex.moves.get(move).target;
  return doubles && battle.actions.targetTypeChoices(target) && !target.startsWith('adjacentAlly') ? ' 1' : '';
}

// A field the twin refuses to start is a scene it cannot play: the caller then rules nothing out.
function standUnderField(battle: Battle, scene: EffectScene) {
  const source = battle.p1.active[0];
  if (scene.weather) battle.field.setWeather(scene.weather, source);
  if (scene.terrain) battle.field.setTerrain(scene.terrain, source);
  for (const id of scene.fields ?? []) battle.field.addPseudoWeather(id, source);
  const standing = (scene.weather ? battle.field.isWeather(scene.weather) : true) && (scene.terrain ? battle.field.isTerrain(scene.terrain) : true)
    && (scene.fields ?? []).every(id => !!battle.field.pseudoWeather[id]);
  if (!standing) throw new Error('the twin cannot stand under the field of the scene');
}

function giveTargetState(battle: Battle, scene: EffectScene) {
  const source = battle.p1.active[0];
  const target = battle.p2.active[0];
  if (scene.target.types?.length) target.setType(scene.target.types as never);
  for (const id of scene.target.volatiles ?? []) {
    if (!battle.dex.conditions.get(id).exists) continue;
    if (!target.addVolatile(id, source) && !target.volatiles[id]) throw new Error(`the twin cannot give ${id}`);
  }
}

// Dice forced lucky, so a miss never reads as a refusal; the answer is the target's `|-damage|` line without `[from]`.
// A transforming body (Imposter) plays another battle than the log shows: the scene answers null.
function hitLands(dex: RulesDex, scene: EffectScene): boolean {
  const battle = twinOf(dex, scene);
  const doubles = !!scene.partner;
  standUnderField(battle, scene);
  giveTargetState(battle, scene);
  battle.randomChance = () => true;
  // The target does not act on the twin: Protean and Libero would change its type with the move it uses first.
  battle.onEvent('BeforeMove', battle.format, (pokemon: { side: unknown }) => (pokemon.side === battle.p2 ? false : undefined));
  const mark = battle.log.length;
  const move = scene.move ?? NO_MOVE;
  battle.makeChoices(doubles ? `move 1${aimOf(battle, move, doubles)}, move 1` : 'move 1', doubles ? 'move 1, move 1' : 'move 1');
  if (battle.log.some(line => line.startsWith('|-transform|'))) throw new Error('a transform plays another battle');
  return battle.log.slice(mark).some(line => line.startsWith('|-damage|p2a: ') && !line.includes('[from]'));
}

const memoByDex = new WeakMap<RulesDex, Map<string, boolean | null>>();

let plays = 0;
export const twinPlays = (): number => plays;

function remembered(dex: RulesDex, key: string, ask: () => boolean | null): boolean | null {
  const memo = memoByDex.get(dex) ?? new Map<string, boolean | null>();
  memoByDex.set(dex, memo);
  if (!memo.has(key)) memo.set(key, ask());
  return memo.get(key)!;
}

/** True when the simulator lets the effect land, false when a handler refuses it, null when the scene is unplayable. */
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

// `Immunity` is left out: it runs for powder, statuses and weather damage, and no damaging move is a powder move.
// landed-hit-sweep.spec.ts holds the list to the Dex: no ability may refuse a hit with a handler outside it.
const HIT_HANDLER = /^on(Ally|Foe|Any|Source)?(TryHit|TryHitSide|TryMove|RedirectTarget|TryPrimaryHit|Damage|Effectiveness)(Priority|Order|SubOrder)?$/;
const FIELD_HANDLER = /^on(Weather|Terrain)Change(Priority|Order|SubOrder)?$/;

// Levitate is read inside `isGrounded`, no handler; a Surge starts a field on entry; Forecast and Mimicry change types.
function changesTheScene(dex: RulesDex, ability: string, reactsToField: boolean): boolean | null {
  try {
    // A grounded species that can hold the ability first: a Flying body shows no Levitate.
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

/** Whether an ability could have refused a hit; an unknown ability or an unplayable probe counts as a candidate. */
export function mayRefuseHit(dex: RulesDex, ability: string): boolean {
  const entry = dex.abilities.get(ability);
  if (!entry.exists) return true;
  return remembered(dex, `hitguard|${entry.id}`, () => {
    const keys = Object.keys(entry);
    return keys.some(key => HIT_HANDLER.test(key)) || changesTheScene(dex, entry.name, keys.some(key => FIELD_HANDLER.test(key))) !== false;
  }) !== false;
}
