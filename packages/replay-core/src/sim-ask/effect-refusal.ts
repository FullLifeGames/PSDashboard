import { toID, type ActiveMove, type Battle, type PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD } from '../calc-gen.ts';
import type { RulesDex } from '../rules-dex.ts';
import { twinBattle } from './twin.ts';

/**
 * Round 89 (#110): the simulator's own answer to "would this ability have refused the effect the log shows landing?". The
 * inference reads a landed flinch, stat drop, status, confusion or Taunt as proof that the body's ability was none of the
 * abilities that refuse it; which abilities refuse it is the Dex handlers' business (`onTryAddVolatile`, `onTryBoost`,
 * `onSetStatus`, `onImmunity`, `onModifySecondaries`, `onTryHit` and the `onAlly` twins of the first four), and no list of
 * names stands here. A scene is played on a fresh twin battle (sim-ask/twin.ts) of the replay's generation, mod and game
 * type: the source and the body that took the effect, the ally of the body in doubles, each with the ability the scene
 * names. The twin runs the same events the real move would: the move's own `ModifyMove` event (a Mold Breaker kin sets
 * `ignoreAbility` there, and the battle's own `suppressingAbility` then skips the breakable handlers), the secondary filter
 * for an effect a move's secondary adds, `TryHit` for a status move, then the add or boost call the move makes.
 * blocked-effects-sweep.spec.ts holds every verdict to a whole battle played through `choose` for every ability of every
 * generation and mod the corpus plays, singles and doubles.
 *
 * Round 89 (#150): a fourth kind of effect, the hit itself. The twin plays the move through the simulator's own turn (`choose` with the
 * dice forced lucky: `ModifyMove`, `ModifyType`, the redirect of a doubles ally, `TryHit`, the immunity checks, `onFoeTryMove`), under the
 * weather, terrain and field conditions the log shows and with the target's item, types and volatile conditions, and answers whether the
 * damage line of the hit (`|-damage|` without `[from]`) came out. landed-hit-sweep.spec.ts holds it to whole battles the same way.
 */

/**
 * One body of a scene: the species and the ability the twin gives it ('' leaves it without one: inert). The target of a hit may carry
 * what the log shows of it (its item, its types now, the volatile conditions it stands under: Ingrain and Smack Down ground it).
 */
export interface SceneBody { species: string; ability: string; item?: string; types?: string[]; volatiles?: string[] }

/** What landed: a volatile (flinch, confusion, Taunt, Encore, ...), a major status, a stat drop of one stat, or the damage of a move's hit. */
export interface SceneEffect { kind: 'volatile' | 'status' | 'boost' | 'hit'; id: string; stat?: string }

export interface EffectScene {
  /** The body that took the effect. */
  target: SceneBody;
  /** The target's ally on the field in doubles, absent in singles. */
  partner?: SceneBody;
  /** The body that dealt the effect (the move's user, the Intimidate holder). */
  source: SceneBody;
  effect: SceneEffect;
  /** How the effect reached the target: a status move's own field, a damaging move's secondary, or an ability's call. */
  route: 'primary' | 'secondary' | 'ability';
  /** The move that dealt it (primary and secondary routes), as the log names it. */
  move?: string;
  /** The ability that dealt it (the ability route). */
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

/** The twin of a scene: source and filler on one side, the target and its ally (or a filler) on the other, all on the field. */
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

/** Plays the scene's events up to the effect's own call, and answers whether the call went through. */
function play(dex: RulesDex, scene: EffectScene): boolean {
  if (scene.effect.kind === 'hit') return hitLands(dex, scene);
  const battle = twinOf(dex, scene);
  const source = battle.p1.active[0];
  const target = battle.p2.active[0];
  const move = scene.route === 'ability' ? null : battle.dex.getActiveMove(scene.move ?? NO_MOVE);
  battle.activePokemon = source;
  battle.activeMove = move;
  if (scene.weather) battle.field.setWeather(scene.weather, source);
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

/** The choice text of the move at the foe in front: the simulator asks for a target only for the moves that pick one. */
function aimOf(dex: RulesDex, move: string, doubles: boolean): string {
  return doubles && ['normal', 'any', 'adjacentFoe'].includes(dex.moves.get(move).target) ? ' 1' : '';
}

/**
 * Plays the move on the twin through the simulator's own turn (its `ModifyMove`, `ModifyType`, `RedirectTarget`, `TryHit`, immunity and
 * `onFoeTryMove` steps, whatever the generation's mod changes) with the dice forced to their lucky side, so that a miss never reads as a
 * refusal, and answers whether the log shows the damage of the hit on the target: the line the reader looked at, `|-damage|` without `[from]`.
 * The field the log shows (weather, terrain, Gravity and the other pseudo-weathers) stands before the move, the target's types, item and
 * volatile conditions as the client knows them.
 */
function hitLands(dex: RulesDex, scene: EffectScene): boolean {
  const battle = twinOf(dex, scene);
  const doubles = !!scene.partner;
  const source = battle.p1.active[0];
  const target = battle.p2.active[0];
  // A field the twin cannot stand under (a condition it refuses to start) is a scene it cannot play: the caller then rules nothing out.
  // A field that already stands (an ability of the twin's own bodies set it on entry, as in the game) is the field of the scene.
  if (scene.weather) battle.field.setWeather(scene.weather, source);
  if (scene.terrain) battle.field.setTerrain(scene.terrain, source);
  for (const id of scene.fields ?? []) battle.field.addPseudoWeather(id, source);
  const standing = (scene.weather ? battle.field.isWeather(scene.weather) : true) && (scene.terrain ? battle.field.isTerrain(scene.terrain) : true)
    && (scene.fields ?? []).every(id => !!battle.field.pseudoWeather[id]);
  if (!standing) throw new Error('the twin cannot stand under the field of the scene');
  if (scene.target.types?.length) target.setType(scene.target.types as never);
  for (const id of scene.target.volatiles ?? []) {
    if (!battle.dex.conditions.get(id).exists) continue;
    if (!target.addVolatile(id, source) && !target.volatiles[id]) throw new Error(`the twin cannot give ${id}`);
  }
  battle.randomChance = () => true;
  const mark = battle.log.length;
  const move = scene.move ?? NO_MOVE;
  battle.makeChoices(doubles ? `move 1${aimOf(dex, move, doubles)}, move 1` : 'move 1', doubles ? 'move 1, move 1' : 'move 1');
  return battle.log.slice(mark).some(line => line.startsWith('|-damage|p2a: ') && !line.includes('[from]'));
}

const memoByDex = new WeakMap<RulesDex, Map<string, boolean | null>>();

/** Asked once per Dex and scene. */
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
    try {
      return play(dex, scene);
    } catch {
      return null;
    }
  });
}

/** Whether a user holding the ability sets `ignoreAbility` on the move in its own `ModifyMove` event (asked once per Dex, ability and move). */
function ignores(dex: RulesDex, ability: string, move: string): boolean | null {
  return remembered(dex, `ignore|${toID(ability)}|${toID(move)}`, () => {
    try {
      // The event reads the user's ability and the move, no species: the first one the Dex holds in the generation stands in.
      const species = dex.species.all().find(entry => entry.exists && entry.gen <= dex.gen && !entry.isNonstandard)!.name;
      const battle = twinBattle(formatOf(dex, false), {
        p1: { name: 'Source', team: [body({ species, ability }, [NO_MOVE])] }, p2: { name: 'Target', team: [body({ species, ability: '' }, [NO_MOVE])] },
      });
      const active = battle.dex.getActiveMove(move);
      battle.activePokemon = battle.p1.active[0];
      battle.activeMove = active;
      battle.runEvent('ModifyMove', battle.p1.active[0], battle.p2.active[0], active, active);
      return !!active.ignoreAbility;
    } catch {
      return null;
    }
  });
}

/**
 * Whether the move's user may ignore the target's ability: the move's own `ignoreAbility` (Sunsteel Strike, Moongeist Beam), or one
 * of the abilities its species can hold sets it in the move's `ModifyMove` event (Mold Breaker, Teravolt, Turboblaze; Mycelium Might
 * for a status move), asked of the simulator. Null when the species is unknown or a question cannot be played.
 */
export function mayIgnoreAbility(dex: RulesDex, species: string, move: string): boolean | null {
  const entry = dex.species.get(species);
  if (!entry.exists) return null;
  const abilities = [...new Set(Object.values(entry.abilities ?? {}) as string[])];
  const verdicts = (abilities.length ? abilities : ['']).map(ability => ignores(dex, ability, move));
  return verdicts.some(verdict => verdict === true) ? true : verdicts.some(verdict => verdict === null) ? null : false;
}
