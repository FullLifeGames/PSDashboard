import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { toId } from '../src/ids';
import type { RulesDex } from '../src/rules-dex';
import { mayIgnoreAbility } from '../src/sim-ask/effect-refusal';
import { play, type PlayBody } from './blocked-effects-play';

/**
 * Round 89 (#110): the sweep that holds the reader of blocked-effects.ts to the simulator. For every ability of every generation and
 * mod the corpus plays with abilities (Generations 3 to 9 and the Champions mod), in singles and in doubles, a species that can
 * hold the ability takes one of 17 effects (a flinch, Intimidate, a primary and a secondary drop, each kind of status by a status
 * move and by a secondary, confusion, Taunt, Encore, Torment, a status under sun, which Leaf Guard needs). The scene is played on @pkmn/sim through
 * `choose` once with no ability on the target (the log the inference reads) and once with each ability of the species. The expected
 * set is every ability of the species under which the effect did NOT land in the played battle; the inference reads the first
 * log and must rule out exactly that set. The two failures a sweep exists for:
 *  - a false rule-out (the inference rules out an ability under which the simulator let the effect land): never allowed;
 *  - a miss (the simulator refused the effect, the inference did not rule the ability out): allowed only for the scenes in `UNREAD`,
 *    each pinned with the reason (the effect never reached the body at all, or the ability is not a guard of this effect).
 * Doubles run the same scenes with an ally on the field, and a second sweep gives the ally the ability (the `onAlly` guards: Flower
 * Veil, Sweet Veil, Pastel Veil, Aroma Veil and any the Dex adds): the ally's candidates are ruled out by what lands on the body next
 * to it. A third sweep plays every species as the source of the flinch against a body that holds Inner Focus or nothing: the species'
 * abilities decide whether the attacker may ignore the target's ability (Mold Breaker, Teravolt, Turboblaze), and the inference must
 * rule Inner Focus out exactly when no ability of the attacker's species ignores it. The default run plays the abilities that have a
 * guard handler (`onTryAddVolatile`, `onTryBoost`, `onTryHit`, `onSetStatus`, `onImmunity`, `onModifySecondaries`, `onAllyTry*`, `onAllySetStatus`; every third of them) and every 24th of the rest; with
 * `DICE_SWEEPS=full` (its own CI job) it plays every ability; doubles play in Generations 5 and 9, the full run in all realms.
 */

const FULL = process.env.DICE_SWEEPS === 'full';

interface Realm { name: string; gen: number; champions?: boolean }
const REALMS: Realm[] = [
  { name: 'Generation 3', gen: 3 }, { name: 'Generation 4', gen: 4 }, { name: 'Generation 5', gen: 5 }, { name: 'Generation 6', gen: 6 },
  { name: 'Generation 7', gen: 7 }, { name: 'Generation 8', gen: 8 }, { name: 'Generation 9', gen: 9 }, { name: 'Champions mod', gen: 9, champions: true },
];
const dexOf = (realm: Realm): RulesDex => (realm.champions ? Dex.dexes.champions : Dex.forGen(realm.gen)) as RulesDex;
const formatOf = (realm: Realm, doubles: boolean) => `gen${realm.gen}${realm.champions ? 'champions' : ''}${doubles ? 'doubles' : ''}customgame`;

interface Scene {
  id: string;
  minGen: number;
  /** The source's moves, one used per turn. */
  moves: string[];
  /** The source's ability ('' for none). */
  sourceAbility?: string;
  /** The line that shows the effect on the target `Target`. */
  landed: RegExp;
  /** A move that picks one foe: the ally sweep plays only these. */
  single: boolean;
  /** A dice-bound effect (an accuracy below 100, a secondary chance): an ability that changes the dice (No Guard, Forewarn) needs more than one seed to show it. */
  chance?: boolean;
}
const onTarget = (command: string, rest: string) => new RegExp(`\\|${command}\\|p2a: Target\\|${rest}`);
const SCENES: Scene[] = [
  { id: 'flinch (Fake Out)', minGen: 3, moves: ['Fake Out'], landed: onTarget('cant', 'flinch'), single: true },
  { id: 'Intimidate', minGen: 3, moves: ['Splash'], sourceAbility: 'Intimidate', landed: onTarget('-unboost', 'atk\\|'), single: false },
  { id: 'primary drop (Growl)', minGen: 3, moves: ['Growl'], landed: onTarget('-unboost', 'atk\\|'), single: false },
  { id: 'primary drop of one body (Charm)', minGen: 3, moves: ['Charm'], landed: onTarget('-unboost', 'atk\\|'), single: true },
  { id: 'secondary drop (Mud-Slap)', minGen: 3, moves: ['Mud-Slap'], landed: onTarget('-unboost', 'accuracy\\|'), single: true },
  { id: 'sleep (Spore)', minGen: 3, moves: ['Spore'], landed: onTarget('-status', 'slp'), single: true },
  { id: 'paralysis (Thunder Wave)', minGen: 3, moves: ['Thunder Wave'], landed: onTarget('-status', 'par'), single: true, chance: true },
  { id: 'poison (Toxic)', minGen: 3, moves: ['Toxic'], landed: onTarget('-status', 'tox'), single: true, chance: true },
  { id: 'burn (Will-O-Wisp)', minGen: 3, moves: ['Will-O-Wisp'], landed: onTarget('-status', 'brn'), single: true, chance: true },
  { id: 'secondary paralysis (Body Slam)', minGen: 3, moves: ['Body Slam'], landed: onTarget('-status', 'par'), single: true, chance: true },
  { id: 'secondary freeze (Ice Beam)', minGen: 3, moves: ['Ice Beam'], landed: onTarget('-status', 'frz'), single: true, chance: true },
  { id: 'confusion (Confuse Ray)', minGen: 3, moves: ['Confuse Ray'], landed: onTarget('-start', 'confusion'), single: true },
  { id: 'Taunt', minGen: 4, moves: ['Taunt'], landed: onTarget('-start', 'move: Taunt'), single: true },
  { id: 'Encore', minGen: 3, moves: ['Splash', 'Encore'], landed: onTarget('-start', 'Encore'), single: true },
  { id: 'Torment', minGen: 3, moves: ['Torment'], landed: onTarget('-start', 'Torment'), single: true },
  { id: 'sleep under sun', minGen: 3, moves: ['Sunny Day', 'Spore'], landed: onTarget('-status', 'slp'), single: true },
  { id: 'paralysis under sun', minGen: 3, moves: ['Sunny Day', 'Thunder Wave'], landed: onTarget('-status', 'par'), single: true, chance: true },
];

const SEEDS = Array.from({ length: 60 }, (_, index) => `${index + 1},2,3,4`);
const SOURCE: PlayBody = { species: 'Smeargle', ability: '' };
const FILLER: PlayBody = { species: 'Chansey', ability: 'Natural Cure' };

const aimOf = (dex: RulesDex, move: string, doubles: boolean) => (doubles && ['normal', 'any', 'adjacentFoe'].includes(dex.moves.get(move).target) ? ' 1' : '');

/** One battle: the source (and a filler) against the target (and the ally, else a filler). */
function battleOf(realm: Realm, doubles: boolean, scene: Scene, target: PlayBody, ally: PlayBody | null, seed: string, user: PlayBody = SOURCE): string {
  const dex = dexOf(realm);
  const source = { ...user, ability: scene.sourceAbility ?? user.ability, moves: scene.moves, name: 'Source' };
  return play({
    format: formatOf(realm, doubles), seed,
    p1: [source, { ...FILLER, name: 'Filler' }], p2: [{ ...target, moves: ['Splash'], name: 'Target' }, ally ? { ...ally, moves: ['Splash'], name: 'Ally' } : { ...FILLER, name: 'Filler' }],
    turns: scene.moves.map((move, index) => ({
      p1: doubles ? `move ${index + 1}${aimOf(dex, move, doubles)}, move 1` : `move ${index + 1}`, p2: doubles ? 'move 1, move 1' : 'move 1',
    })),
  });
}

/** The log of the scene with the first seed that shows the effect on a target with no ability, null when none does. */
function baseline(realm: Realm, doubles: boolean, scene: Scene, target: PlayBody, ally: PlayBody | null, user: PlayBody = SOURCE): { log: string; seed: string } | null {
  for (const seed of SEEDS) {
    const log = battleOf(realm, doubles, scene, target, ally, seed, user);
    if (scene.landed.test(log)) return { log, seed };
  }
  return null;
}

/**
 * Whether the effect lands on the target with the ability: on the baseline's seed, else on any other seed of the list (a dice-bound
 * effect needs many, an ability that halves a status move's accuracy needs a few). A target that transforms into the source (Imposter) is
 * no refusal: it copies the source's moves, and the scene then plays another battle.
 */
function landsWith(realm: Realm, doubles: boolean, scene: Scene, target: PlayBody, ally: PlayBody | null, seed: string, user: PlayBody = SOURCE): boolean {
  const first = battleOf(realm, doubles, scene, target, ally, seed, user);
  if (scene.landed.test(first) || /\|-transform\|/.test(first)) return true;
  const others = SEEDS.slice(0, scene.chance ? SEEDS.length : 12).filter(other => other !== seed);
  return others.some(other => scene.landed.test(battleOf(realm, doubles, scene, target, ally, other, user)));
}

const inferred = new Map<string, string[]>();
/** The abilities the inference rules out for the target species (or the ally) of a log, memoized by the log. */
function ruledOutOf(log: string, species: string): string[] {
  const key = `${species}|${log}`;
  if (!inferred.has(key)) inferred.set(key, inferOpponentTeam(log, 'p2').pokemon.find(mon => toId(mon.species) === toId(species))?.ruledOut?.abilities ?? []);
  return inferred.get(key)!;
}

const GUARD = /^on(Try(AddVolatile|Boost|Hit)|SetStatus|Immunity|ModifySecondaries|Ally(Try|SetStatus))/;
/** Doubles take far longer than singles: the default run plays two generations of them (the oldest ally rules and the newest; the Champions mod in singles only). */
const DOUBLES_DEFAULT = ['Generation 5', 'Generation 9'];
const doublesRealms = (): Realm[] => REALMS.filter(realm => FULL || DOUBLES_DEFAULT.includes(realm.name));

/** The species the sweep plays for each ability of the realm: the first that can hold it, preferring one with another ability to compare. */
function speciesPerAbility(dex: RulesDex): Map<string, { species: string; abilities: string[]; guard: boolean }> {
  const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && ability.id !== 'noability');
  const species = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  const picks = new Map<string, { species: string; abilities: string[]; guard: boolean }>();
  let guards = 0;
  abilities.forEach((ability, index) => {
    const guard = Object.keys(ability).some(key => GUARD.test(key));
    if (!FULL && (guard ? guards++ % 3 !== 0 : index % 24 !== 0)) return;
    const holders = species.filter(entry => Object.values(entry.abilities).includes(ability.name));
    const holder = holders.find(entry => new Set(Object.values(entry.abilities)).size >= 2) ?? holders[0];
    if (holder) picks.set(holder.name, { species: holder.name, abilities: [...new Set(Object.values(holder.abilities) as string[])], guard });
  });
  return picks;
}

/**
 * Refusals the reader leaves unread, by scene: the guard refuses the move itself and never the effect (the priority guards Armor Tail,
 * Dazzling and Queenly Majesty stop Fake Out; Earth Eater absorbs the Ground move that carries the secondary), so the log's effect
 * proves the guard away only through the move's own refusal, which is outside the approved reading (a flinch, a drop, a status or a
 * volatile). Each is a TODO proposal for the final gate (lanes/D/d6-todo-proposals.md); a pin the reader now reads turns the row red.
 */
const UNREAD: Record<string, string[]> = {
  'flinch (Fake Out)': ['armortail', 'dazzling', 'queenlymajesty'],
  'secondary drop (Mud-Slap)': ['eartheater'],
  // The gas stops the activation of the source's Intimidate on the field; the log of a holder shows the gas itself, so the log without it is the absence read.
  Intimidate: ['neutralizinggas'],
};

interface Verdict { missed: string[]; falseRuleOuts: string[]; stalePins: string[]; played: number; skipped: number }

/** The sweep of one realm and game type over the target's own abilities. */
function sweepTargets(realm: Realm, doubles: boolean): Verdict {
  const dex = dexOf(realm);
  const verdict: Verdict = { missed: [], falseRuleOuts: [], stalePins: [], played: 0, skipped: 0 };
  for (const pick of speciesPerAbility(dex).values()) {
    for (const scene of SCENES.filter(entry => entry.minGen <= realm.gen)) {
      const base = baseline(realm, doubles, scene, { species: pick.species, ability: '' }, null);
      if (!base) { verdict.skipped++; continue; }
      verdict.played++;
      const blocked = pick.abilities.filter(ability => !landsWith(realm, doubles, scene, { species: pick.species, ability }, null, base.seed));
      const expected = blocked.length === pick.abilities.length ? [] : blocked.map(toId);
      const got = ruledOutOf(base.log, pick.species);
      for (const id of got) if (!expected.includes(id) && !['levitate', 'magicguard'].includes(id)) verdict.falseRuleOuts.push(`${pick.species} ${scene.id}: ${id}`);
      for (const id of expected) if (!got.includes(id) && !UNREAD[scene.id]?.includes(id)) verdict.missed.push(`${pick.species} ${scene.id}: ${id}`);
      for (const id of got) if (UNREAD[scene.id]?.includes(id)) verdict.stalePins.push(`${pick.species} ${scene.id}: ${id}`);
    }
  }
  return verdict;
}

describe('every ability of every generation and mod: the inference rules out what the simulator refused', () => {
  for (const realm of REALMS) {
    for (const doubles of [false, true].filter(entry => !entry || FULL || DOUBLES_DEFAULT.includes(realm.name))) {
      test(`${realm.name}, ${doubles ? 'doubles' : 'singles'}: no false rule-out, no unread refusal`, () => {
        const verdict = sweepTargets(realm, doubles);
        expect(verdict.played).toBeGreaterThan(0);
        expect(verdict.falseRuleOuts).toEqual([]);
        expect(verdict.missed).toEqual([]);
        expect(verdict.stalePins).toEqual([]);
      }, 600_000);
    }
  }
});

/** The ally sweep: the ability sits on the ally of the body that takes the effect (a Grass body, then a body of another type). */
function sweepAllies(realm: Realm): Verdict {
  const dex = dexOf(realm);
  const verdict: Verdict = { missed: [], falseRuleOuts: [], stalePins: [], played: 0, skipped: 0 };
  const holders = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  const grass = holders.find(entry => entry.types.length === 1 && entry.types[0] === 'Grass')!;
  const other = holders.find(entry => entry.types.length === 1 && entry.types[0] === 'Normal')!;
  const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && ability.id !== 'noability');
  const allyOf = (ability: (typeof abilities)[number]) => holders.find(entry => Object.values(entry.abilities).includes(ability.name));
  const picks = new Map<string, { species: string; abilities: string[] }>();
  abilities.forEach((ability, index) => {
    const ally = allyOf(ability);
    if (ally && (Object.keys(ability).some(key => key.startsWith('onAlly')) || (FULL && index % 3 === 0))) picks.set(ally.name, { species: ally.name, abilities: [...new Set(Object.values(ally.abilities) as string[])] });
  });
  for (const pick of picks.values()) {
    for (const scene of SCENES.filter(entry => entry.single && entry.minGen <= realm.gen)) {
      for (const target of [grass, other]) {
        const body = { species: target.name, ability: '' };
        const base = baseline(realm, true, scene, body, { species: pick.species, ability: '' });
        if (!base) { verdict.skipped++; continue; }
        verdict.played++;
        const blocked = pick.abilities.filter(ability => !landsWith(realm, true, scene, body, { species: pick.species, ability }, base.seed));
        const expected = blocked.length === pick.abilities.length ? [] : blocked.map(toId);
        const got = ruledOutOf(base.log, pick.species);
        const label = `${pick.species} beside ${target.name}, ${scene.id}`;
        for (const id of got) if (!expected.includes(id) && !['levitate', 'magicguard'].includes(id)) verdict.falseRuleOuts.push(`${label}: ${id}`);
        for (const id of expected) if (!got.includes(id) && !UNREAD[scene.id]?.includes(id)) verdict.missed.push(`${label}: ${id}`);
      }
    }
  }
  return verdict;
}

describe('the ally\'s ability: what lands on the body next to it rules out the guards of the onAlly kind', () => {
  for (const realm of doublesRealms()) {
    test(`${realm.name}, doubles: no false rule-out, no unread refusal`, () => {
      const verdict = sweepAllies(realm);
      expect(verdict.played).toBeGreaterThan(0);
      expect(verdict.falseRuleOuts).toEqual([]);
      expect(verdict.missed).toEqual([]);
    }, 600_000);
  }
});

/** The sweep over the attacker's species: the flinch rules Inner Focus out exactly when no ability of the attacker's species ignores it. */
function sweepSources(realm: Realm): { wrong: string[]; played: number; ignoring: number } {
  const dex = dexOf(realm);
  const found = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  const target = found.find(entry => Object.values(entry.abilities).includes('Inner Focus') && new Set(Object.values(entry.abilities)).size >= 2);
  if (!target) return { wrong: [], played: 0, ignoring: 0 };
  const flinch = SCENES[0];
  const wrong: string[] = [];
  let played = 0, ignoring = 0;
  const attackers = found.filter((entry, index) => FULL || index % 8 === 0 || Object.values(entry.abilities).some(name => /Mold Breaker|Teravolt|Turboblaze|Neutralizing Gas|Mycelium Might/.test(String(name))));
  for (const entry of attackers) {
    const own = [...new Set(Object.values(entry.abilities) as string[])];
    const logs = own.map(ability => battleOf(realm, false, flinch, { species: target.name, ability: 'Inner Focus' }, null, '1,2,3,4', { species: entry.name, ability }));
    // An attacker that transforms into the target (Imposter) copies the target's moves: the scene plays another battle, no refusal and no ignore.
    if (logs.some(log => /\|-transform\|/.test(log))) continue;
    const may = logs.some(log => flinch.landed.test(log));
    const calm = own.find((ability, index) => !flinch.landed.test(logs[index])) ?? own[0];
    const base = baseline(realm, false, flinch, { species: target.name, ability: '' }, null, { species: entry.name, ability: calm });
    if (!base) continue;
    played++;
    if (may) ignoring++;
    const ruled = ruledOutOf(base.log, target.name).includes('innerfocus');
    if (ruled === may) wrong.push(`${entry.name}: the attacker ${may ? 'may' : 'cannot'} ignore Inner Focus, the inference ${ruled ? 'rules it out' : 'keeps it'}`);
  }
  return { wrong, played, ignoring };
}

describe('the attacker\'s species decides whether the target\'s ability counts', () => {
  for (const realm of REALMS.filter(entry => entry.gen >= 4)) {
    test(`${realm.name}: Inner Focus is ruled out by a flinch unless a possible ability of the attacker ignores it`, () => {
      const verdict = sweepSources(realm);
      expect(verdict.played).toBeGreaterThan(0);
      expect(verdict.ignoring).toBeGreaterThan(0);
      expect(verdict.wrong).toEqual([]);
    }, 600_000);
  }
});

describe('the Levitate rule reads the simulator\'s ignore: its verdicts stay those of the old list of three abilities', () => {
  // The list the rule read before round 89 (#110), kept here as the oracle: an attacker of a species that may hold one of the three.
  const OLD = new Set(['moldbreaker', 'teravolt', 'turboblaze']);
  for (const realm of REALMS) {
    test(`${realm.name}: every species against every Ground move of the Dex`, () => {
      const dex = dexOf(realm);
      const moves = dex.moves.all().filter(move => move.exists && move.type === 'Ground' && move.category !== 'Status' && move.gen <= dex.gen);
      const species = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !String(entry.isNonstandard ?? '').startsWith('Future'));
      const differing: string[] = [];
      for (const entry of species) {
        const old = Object.values(entry.abilities).some(ability => OLD.has(toId(String(ability))));
        for (const move of moves) if (mayIgnoreAbility(dex, entry.name, move.name) !== old) differing.push(`${entry.name} ${move.name}`);
      }
      expect(moves.length).toBeGreaterThan(0);
      expect(differing).toEqual([]);
    }, 300_000);
  }
});
