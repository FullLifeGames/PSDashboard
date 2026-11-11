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
 */

/** One body of a scene: the species and the ability the twin gives it ('' leaves it without one: inert). */
export interface SceneBody { species: string; ability: string }

/** What landed: a volatile (flinch, confusion, Taunt, Encore, ...), a major status, or a stat drop of one stat. */
export interface SceneEffect { kind: 'volatile' | 'status' | 'boost'; id: string; stat?: string }

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
}

const body = (entry: SceneBody, moves: string[]): PokemonSet => ({
  name: entry.species, species: entry.species, item: '', ability: entry.ability, moves, nature: 'Hardy', gender: '', level: 100,
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

const formatOf = (dex: RulesDex, doubles: boolean): string =>
  `gen${dex.gen}${dex.currentMod === CHAMPIONS_MOD ? 'champions' : ''}${doubles ? 'doubles' : ''}customgame`;

// eslint-disable-next-line names/no-new-dex-name -- the twin's warm-up move: any move that does nothing (blocked-effects-sweep.spec.ts plays the same scenes through whole battles)
const NO_MOVE = 'splash';

/** The twin of a scene: source and filler on one side, the target and its ally (or a filler) on the other, all on the field. */
function twinOf(dex: RulesDex, scene: EffectScene): Battle {
  const doubles = !!scene.partner;
  const filler = { species: scene.source.species, ability: '' };
  const p1 = doubles ? [body(scene.source, [NO_MOVE]), body(filler, [NO_MOVE])] : [body(scene.source, [NO_MOVE])];
  const p2 = doubles ? [body(scene.target, [NO_MOVE]), body(scene.partner!, [NO_MOVE])] : [body(scene.target, [NO_MOVE])];
  const battle = twinBattle(formatOf(dex, doubles), { p1: { name: 'Source', team: p1 }, p2: { name: 'Target', team: p2 } });
  // One turn of Splash, so that the bodies have moved: an effect that reads the target's last move (Encore, Disable) asks for it.
  const choice = doubles ? 'move 1, move 1' : 'move 1';
  battle.makeChoices(choice, choice);
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
