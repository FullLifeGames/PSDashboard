import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { toId } from '../src/ids';
import type { RulesDex } from '../src/rules-dex';
import { play, type PlayBody } from './blocked-effects-play';

// `DICE_SWEEPS=full` plays every ability; a plain run every third guard-handler ability and every 24th of the rest.

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
  moves: string[];
  sourceAbility?: string;
  landed: RegExp;
  single: boolean;
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
// The source holds an ability its species has: Trace copies a body with none as nothing.
const sourceOf = (realm: Realm): PlayBody => {
  const abilities = dexOf(realm).species.get('Smeargle').abilities as Record<string, string>;
  return { species: 'Smeargle', ability: abilities['1'] ?? abilities['0'] };
};
const FILLER: PlayBody = { species: 'Chansey', ability: 'Natural Cure' };

const aimOf = (dex: RulesDex, move: string, doubles: boolean) => (doubles && ['normal', 'any', 'adjacentFoe'].includes(dex.moves.get(move).target) ? ' 1' : '');

function battleOf(realm: Realm, doubles: boolean, scene: Scene, target: PlayBody, ally: PlayBody | null, seed: string, user: PlayBody = sourceOf(realm)): string {
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

function baseline(realm: Realm, doubles: boolean, scene: Scene, target: PlayBody, ally: PlayBody | null, user: PlayBody = sourceOf(realm)): { log: string; seed: string } | null {
  for (const seed of SEEDS) {
    const log = battleOf(realm, doubles, scene, target, ally, seed, user);
    if (scene.landed.test(log)) return { log, seed };
  }
  return null;
}

// A target that transforms into the source (Imposter) is no refusal: it copies the source's moves.
function landsWith(realm: Realm, doubles: boolean, scene: Scene, target: PlayBody, ally: PlayBody | null, seed: string, user: PlayBody = sourceOf(realm)): boolean {
  const first = battleOf(realm, doubles, scene, target, ally, seed, user);
  if (scene.landed.test(first) || /\|-transform\|/.test(first)) return true;
  const others = SEEDS.slice(0, scene.chance ? SEEDS.length : 12).filter(other => other !== seed);
  return others.some(other => scene.landed.test(battleOf(realm, doubles, scene, target, ally, other, user)));
}

const inferred = new Map<string, string[]>();
function ruledOutOf(log: string, species: string): string[] {
  const key = `${species}|${log}`;
  if (!inferred.has(key)) inferred.set(key, inferOpponentTeam(log, 'p2').pokemon.find(mon => toId(mon.species) === toId(species))?.ruledOut?.abilities ?? []);
  return inferred.get(key)!;
}

const GUARD = /^on(Try(AddVolatile|Boost|Hit)|SetStatus|Immunity|ModifySecondaries|Ally(Try|SetStatus))/;
const ALWAYS = ['trace', 'leafguard', 'lightningrod', 'psychicsurge'];
const DOUBLES_DEFAULT = ['Generation 5', 'Generation 9'];

function speciesPerAbility(dex: RulesDex): Map<string, { species: string; abilities: string[]; guard: boolean }> {
  const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && ability.id !== 'noability');
  const species = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  const picks = new Map<string, { species: string; abilities: string[]; guard: boolean }>();
  let guards = 0;
  abilities.forEach((ability, index) => {
    const guard = Object.keys(ability).some(key => GUARD.test(key));
    if (!FULL && !ALWAYS.includes(ability.id) && (guard ? guards++ % 3 !== 0 : index % 24 !== 0)) return;
    const holders = species.filter(entry => Object.values(entry.abilities).includes(ability.name));
    const holder = holders.find(entry => new Set(Object.values(entry.abilities)).size >= 2) ?? holders[0];
    if (holder) picks.set(holder.name, { species: holder.name, abilities: [...new Set(Object.values(holder.abilities) as string[])], guard });
  });
  return picks;
}

// The guard refuses the move itself, never the effect: the log proves it away only through the move's own refusal.
const UNREAD: Record<string, string[]> = {
  Intimidate: ['neutralizinggas'],
};

// Lightning Rod on the ally draws the Thunder Wave aimed at its partner: a redirect, no refusal of the effect.
const UNREAD_ALLY: Record<string, string[]> = {
  'paralysis (Thunder Wave)': ['lightningrod'],
  'paralysis under sun': ['lightningrod'],
};

interface Verdict { missed: string[]; falseRuleOuts: string[]; stalePins: string[]; played: number; skipped: number }

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

function sweepAllies(realm: Realm): Verdict {
  const dex = dexOf(realm);
  const verdict: Verdict = { missed: [], falseRuleOuts: [], stalePins: [], played: 0, skipped: 0 };
  const holders = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  // One team entry per species: a target of the ally's species would share its entry, so targets differ from it.
  const targetsOf = (ally: string) => ['Grass', 'Normal'].map(type => holders.find(entry => entry.name !== ally && entry.types.length === 1 && entry.types[0] === type)!);
  const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && ability.id !== 'noability');
  const allyOf = (ability: (typeof abilities)[number]) => holders.find(entry => Object.values(entry.abilities).includes(ability.name));
  const picks = new Map<string, { species: string; abilities: string[] }>();
  abilities.forEach((ability, index) => {
    const ally = allyOf(ability);
    if (ally && (Object.keys(ability).some(key => key.startsWith('onAlly')) || ALWAYS.includes(ability.id) || (FULL && index % 3 === 0))) picks.set(ally.name, { species: ally.name, abilities: [...new Set(Object.values(ally.abilities) as string[])] });
  });
  for (const pick of picks.values()) {
    for (const scene of SCENES.filter(entry => entry.single && entry.minGen <= realm.gen)) {
      for (const target of targetsOf(pick.species)) {
        const body = { species: target.name, ability: '' };
        const base = baseline(realm, true, scene, body, { species: pick.species, ability: '' });
        if (!base) { verdict.skipped++; continue; }
        verdict.played++;
        const blocked = pick.abilities.filter(ability => !landsWith(realm, true, scene, body, { species: pick.species, ability }, base.seed));
        const expected = blocked.length === pick.abilities.length ? [] : blocked.map(toId);
        const got = ruledOutOf(base.log, pick.species);
        const label = `${pick.species} beside ${target.name}, ${scene.id}`;
        for (const id of got) if (!expected.includes(id) && !['levitate', 'magicguard'].includes(id)) verdict.falseRuleOuts.push(`${label}: ${id}`);
        for (const id of expected) if (!got.includes(id) && !UNREAD[scene.id]?.includes(id) && !UNREAD_ALLY[scene.id]?.includes(id)) verdict.missed.push(`${label}: ${id}`);
      }
    }
  }
  return verdict;
}

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

export function registerBlockedEffectsSweep(names: string[]): void {
  const realms = REALMS.filter(realm => names.includes(realm.name));
  if (realms.length !== names.length) throw new Error(`unknown realm among ${names.join(', ')}`);
  const allyRealms = realms.filter(realm => FULL || DOUBLES_DEFAULT.includes(realm.name));
  const sourceRealms = realms.filter(entry => entry.gen >= 4);
  describe('every ability of every generation and mod: the inference rules out what the simulator refused', () => {
    for (const realm of realms) {
      for (const doubles of [false, true].filter(entry => !entry || FULL || DOUBLES_DEFAULT.includes(realm.name))) {
        test(`${realm.name}, ${doubles ? 'doubles' : 'singles'}: no false rule-out, no unread refusal`, () => {
          const verdict = sweepTargets(realm, doubles);
          expect(verdict.played).toBeGreaterThan(0);
          expect(verdict.falseRuleOuts).toEqual([]);
          expect(verdict.missed).toEqual([]);
          expect(verdict.stalePins).toEqual([]);
        }, 1_800_000);
      }
    }
  });

  if (allyRealms.length > 0) describe('the ally\'s ability: what lands on the body next to it rules out the guards of the onAlly kind', () => {
    for (const realm of allyRealms) {
      test(`${realm.name}, doubles: no false rule-out, no unread refusal`, () => {
        const verdict = sweepAllies(realm);
        expect(verdict.played).toBeGreaterThan(0);
        expect(verdict.falseRuleOuts).toEqual([]);
        expect(verdict.missed).toEqual([]);
      }, 1_800_000);
    }
  });

  if (sourceRealms.length > 0) describe('the attacker\'s species decides whether the target\'s ability counts', () => {
    for (const realm of sourceRealms) {
      test(`${realm.name}: Inner Focus is ruled out by a flinch unless a possible ability of the attacker ignores it`, () => {
        const verdict = sweepSources(realm);
        expect(verdict.played).toBeGreaterThan(0);
        expect(verdict.ignoring).toBeGreaterThan(0);
        expect(verdict.wrong).toEqual([]);
      }, 1_800_000);
    }
  });
}
