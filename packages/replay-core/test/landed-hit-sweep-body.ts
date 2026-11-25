import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { toId } from '../src/ids';
import type { RulesDex } from '../src/rules-dex';
import { effectLands, mayRefuseHit } from '../src/sim-ask/effect-refusal';
import type { SceneBody } from '../src/sim-ask/effect-refusal';
import { play, type PlayBody } from './blocked-effects-play';

// `DICE_SWEEPS=full` plays every ability; a plain run plays every third hit-guard ability and every 24th of the rest.
// The target never acts (`idle`): an ability that acts with its first move (Protean, Libero) would change the scene.

const FULL = process.env.DICE_SWEEPS === 'full';

interface Realm { name: string; gen: number; champions?: boolean }
const REALMS: Realm[] = [
  { name: 'Generation 3', gen: 3 }, { name: 'Generation 4', gen: 4 }, { name: 'Generation 5', gen: 5 }, { name: 'Generation 6', gen: 6 },
  { name: 'Generation 7', gen: 7 }, { name: 'Generation 8', gen: 8 }, { name: 'Generation 9', gen: 9 }, { name: 'Champions mod', gen: 9, champions: true },
];
const DOUBLES_DEFAULT = ['Generation 5', 'Generation 9'];
const dexOf = (realm: Realm): RulesDex => (realm.champions ? Dex.dexes.champions : Dex.forGen(realm.gen)) as RulesDex;
const formatOf = (realm: Realm, doubles: boolean) => `gen${realm.gen}${realm.champions ? 'champions' : ''}${doubles ? 'doubles' : ''}customgame`;
const SEEDS = Array.from({ length: 12 }, (_, index) => `${index + 1},2,3,4`);

interface HitScene { label: string; move: string; spread: boolean }

const REFERENCE = 'Magikarp';
const FILLER: PlayBody = { species: 'Chansey', ability: 'Natural Cure' };

const aimOf = (dex: RulesDex, move: string, doubles: boolean) => (doubles && ['normal', 'any', 'adjacentFoe'].includes(dex.moves.get(move).target) ? ' 1' : '');

function battleOf(realm: Realm, doubles: boolean, move: string, target: PlayBody, ally: PlayBody | null, seed: string, source: PlayBody): string {
  const dex = dexOf(realm);
  return play({
    format: formatOf(realm, doubles), seed, idle: true,
    p1: [{ ...source, moves: [move], name: 'Source' }, { ...FILLER, name: 'Filler' }],
    p2: [{ ...target, moves: ['Splash'], name: 'Target' }, ally ? { ...ally, moves: ['Splash'], name: 'Ally' } : { ...FILLER, name: 'Filler' }],
    turns: [{ p1: doubles ? `move 1${aimOf(dex, move, doubles)}, move 1` : 'move 1', p2: doubles ? 'move 1, move 1' : 'move 1' }],
  });
}

// The name is not read: with Illusion the log names the disguise (the last party member), not the body.
const LANDED = /\|-damage\|p2a: [^|\n]*\|[^|\n]*(\n|$)/;
const landed = (log: string): boolean => LANDED.test(log);
const clean = (log: string): boolean => landed(log) && !/\|(-status|-unboost|-boost|-start|cant)\|p2a: /.test(log);

const sourceOf = (realm: Realm): PlayBody => {
  const abilities = dexOf(realm).species.get('Smeargle').abilities as Record<string, string>;
  return { species: 'Smeargle', ability: abilities['1'] ?? abilities['0'] };
};

type DexMove = ReturnType<RulesDex['moves']['all']>[number];
const hasEffect = (move: DexMove): boolean => !!move.volatileStatus;
const hasTiming = (move: DexMove): boolean => !!(move.flags.charge || move.flags.recharge || move.flags.futuremove);
const isSpecial = (move: DexMove): boolean => !!(move.isNonstandard || move.multihit || move.selfdestruct || move.isZ || move.isMax || toId(move.name) !== move.id);
const hasHandler = (move: DexMove): boolean => Object.keys(move).some(key => /^on(\w*ModifyType|Try|Hit|AfterMove|Prepare)/.test(key));
function isCleanHit(move: DexMove): boolean {
  const plain = move.category !== 'Status' && move.basePower >= 40 && move.accuracy === 100 && ['normal', 'allAdjacent', 'allAdjacentFoes'].includes(move.target);
  return plain && !isSpecial(move) && !hasHandler(move) && !hasEffect(move) && !hasTiming(move);
}

// A typed Hidden Power (id `hiddenpower`) is no move a log names: the simulator plays `Hidden Power` with the IV type.
function hitScenes(realm: Realm): HitScene[] {
  const dex = dexOf(realm);
  const source = sourceOf(realm);
  const candidates = dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && isCleanHit(move)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const lands = (move: string) => SEEDS.some(seed => clean(battleOf(realm, false, move, { species: REFERENCE, ability: '' }, null, seed, source)));
  const pick = (label: string, filter: (move: (typeof candidates)[number]) => boolean): HitScene | null => {
    for (const move of candidates.filter(filter)) if (lands(move.name)) return { label, move: move.name, spread: move.target !== 'normal' };
    return null;
  };
  const scenes: (HitScene | null)[] = [...new Set(candidates.map(move => move.type))].map(type => pick(`type ${type}`, move => move.type === type));
  scenes.push(pick('sound', move => !!move.flags.sound), pick('bullet', move => !!move.flags.bullet), pick('wind', move => !!move.flags.wind), pick('priority', move => move.priority > 0));
  return scenes.filter((scene): scene is HitScene => !!scene);
}

const scenesMemo = new Map<string, HitScene[]>();
const scenesOf = (realm: Realm): HitScene[] => {
  if (!scenesMemo.has(realm.name)) scenesMemo.set(realm.name, hitScenes(realm));
  return scenesMemo.get(realm.name)!;
};

function landsWith(realm: Realm, doubles: boolean, move: string, target: PlayBody, ally: PlayBody | null, source: PlayBody): boolean {
  return SEEDS.some(seed => {
    const log = battleOf(realm, doubles, move, target, ally, seed, source);
    return landed(log) || /\|-transform\|/.test(log);
  });
}

const inferred = new Map<string, string[]>();
function ruledOutOf(log: string, species: string): string[] {
  const key = `${species}|${log}`;
  if (!inferred.has(key)) inferred.set(key, inferOpponentTeam(log, 'p2').pokemon.find(mon => toId(mon.species) === toId(species))?.ruledOut?.abilities ?? []);
  return inferred.get(key)!;
}

const GUARD = /^on(TryHit|Immunity|FoeTryMove|AnyRedirectTarget|AllyTryHitSide|TryPrimaryHit|Damage|SourceModifyDamage|ModifyMove|Any(Try|Invulnerability))/;
const ALWAYS = ['levitate', 'wonderguard', 'disguise', 'iceface', 'sturdy', 'lightningrod', 'stormdrain', 'dazzling', 'telepathy'];

function speciesPerAbility(dex: RulesDex, wanted: (ability: ReturnType<RulesDex['abilities']['all']>[number], index: number) => boolean): Map<string, { species: string; abilities: string[] }> {
  const abilities = dex.abilities.all().filter(ability => ability.exists && ability.gen <= dex.gen && ability.id !== 'noability');
  const species = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  const picks = new Map<string, { species: string; abilities: string[] }>();
  abilities.forEach((ability, index) => {
    if (!wanted(ability, index)) return;
    const holders = species.filter(entry => Object.values(entry.abilities).includes(ability.name));
    const holder = holders.find(entry => new Set(Object.values(entry.abilities)).size >= 2) ?? holders[0];
    if (holder) picks.set(holder.name, { species: holder.name, abilities: [...new Set(Object.values(holder.abilities) as string[])] });
  });
  return picks;
}

const sampled = (guards: { n: number }) => (ability: { id: string }, index: number): boolean => {
  if (FULL || ALWAYS.includes(ability.id)) return true;
  const guard = Object.keys(ability).some(key => GUARD.test(key));
  return guard ? guards.n++ % 3 === 0 : index % 24 === 0;
};

const UNREAD: Record<string, string[]> = {};

interface Verdict { missed: string[]; falseRuleOuts: string[]; stalePins: string[]; played: number; skipped: number; refused: number }

function sweepTargets(realm: Realm, doubles: boolean): Verdict {
  const dex = dexOf(realm);
  const verdict: Verdict = { missed: [], falseRuleOuts: [], stalePins: [], played: 0, skipped: 0, refused: 0 };
  const source = sourceOf(realm);
  for (const pick of speciesPerAbility(dex, sampled({ n: 0 })).values()) {
    for (const scene of scenesOf(realm)) {
      const base = SEEDS.map(seed => ({ seed, log: battleOf(realm, doubles, scene.move, { species: pick.species, ability: '' }, null, seed, source) })).find(entry => clean(entry.log));
      if (!base) { verdict.skipped++; continue; }
      verdict.played++;
      const blocked = pick.abilities.filter(ability => !landsWith(realm, doubles, scene.move, { species: pick.species, ability }, null, source));
      const expected = blocked.length === pick.abilities.length ? [] : blocked.map(toId);
      verdict.refused += expected.length;
      const got = ruledOutOf(base.log, pick.species);
      const label = `${pick.species} ${scene.label} (${scene.move})`;
      for (const id of got) if (!expected.includes(id) && id !== 'magicguard') verdict.falseRuleOuts.push(`${label}: ${id}`);
      for (const id of expected) if (!got.includes(id) && !UNREAD[scene.label]?.includes(id)) verdict.missed.push(`${label}: ${id}`);
      for (const id of got) if (UNREAD[scene.label]?.includes(id)) verdict.stalePins.push(`${label}: ${id}`);
    }
  }
  return verdict;
}

function sweepAllies(realm: Realm): Verdict {
  const dex = dexOf(realm);
  const verdict: Verdict = { missed: [], falseRuleOuts: [], stalePins: [], played: 0, skipped: 0, refused: 0 };
  const source = sourceOf(realm);
  const ALLY_GUARD = /^on(Any|Ally|Foe)/;
  const picks = speciesPerAbility(dex, (ability, index) => FULL ? index % 3 === 0 || Object.keys(ability).some(key => ALLY_GUARD.test(key)) : ALWAYS.includes(ability.id) || Object.keys(ability).some(key => /^on(AnyRedirectTarget|FoeTryMove|AllyTryHitSide)/.test(key)));
  const target: PlayBody = { species: REFERENCE, ability: '' };
  for (const pick of picks.values()) {
    for (const scene of scenesOf(realm).filter(entry => !entry.spread)) {
      const base = SEEDS.map(seed => ({ seed, log: battleOf(realm, true, scene.move, target, { species: pick.species, ability: '' }, seed, source) })).find(entry => clean(entry.log));
      if (!base) { verdict.skipped++; continue; }
      verdict.played++;
      const blocked = pick.abilities.filter(ability => !landsWith(realm, true, scene.move, target, { species: pick.species, ability }, source));
      const expected = blocked.length === pick.abilities.length ? [] : blocked.map(toId);
      verdict.refused += expected.length;
      const got = ruledOutOf(base.log, pick.species);
      const label = `${pick.species} beside ${REFERENCE}, ${scene.label} (${scene.move})`;
      for (const id of got) if (!expected.includes(id) && id !== 'magicguard') verdict.falseRuleOuts.push(`${label}: ${id}`);
      for (const id of expected) if (!got.includes(id) && !UNREAD[scene.label]?.includes(id)) verdict.missed.push(`${label}: ${id}`);
    }
  }
  return verdict;
}

// The attacker's ability is unknown in the log unless it announces itself, so the target's ability is ruled out
// only when no ability of the attacker's species lets the hit through.
const SOURCE_SCENES = [
  { label: 'Water move into Storm Drain', move: 'Water Gun', target: 'Gastrodon', refuser: 'Storm Drain', other: 'Sticky Hold' },
  { label: 'Normal sound move into Storm Drain (Liquid Voice)', move: 'Hyper Voice', target: 'Gastrodon', refuser: 'Storm Drain', other: 'Sticky Hold' },
  { label: 'Normal move into Volt Absorb (Galvanize)', move: 'Tackle', target: 'Jolteon', refuser: 'Volt Absorb', other: 'Quick Feet' },
  { label: 'Electric move into Volt Absorb', move: 'Thunder Shock', target: 'Jolteon', refuser: 'Volt Absorb', other: 'Quick Feet' },
];

function sweepSources(realm: Realm): { wrong: string[]; played: number; ignoring: number } {
  const dex = dexOf(realm);
  const found = dex.species.all().filter(entry => entry.exists && entry.gen <= dex.gen && !entry.battleOnly && !String(entry.isNonstandard ?? '').startsWith('Future'));
  const shifting = (name: string) => Object.keys(dex.abilities.get(name)).some(key => /^on(\w*ModifyType|ModifyMove)/.test(key));
  const attackers = found.filter((entry, index) => FULL || index % 8 === 0 || Object.values(entry.abilities).some(name => shifting(String(name))));
  const wrong: string[] = [];
  let played = 0, ignoring = 0;
  for (const scene of SOURCE_SCENES) {
    const target = dex.species.get(scene.target);
    if (!target.exists || target.gen > dex.gen || !Object.values(target.abilities).includes(scene.refuser) || !dex.moves.get(scene.move).exists) continue;
    const others = [...new Set(Object.values(target.abilities) as string[])];
    for (const entry of attackers) {
      const own = [...new Set(Object.values(entry.abilities) as string[])];
      const bodyOf = (ability: string): PlayBody => ({ species: entry.name, ability });
      const bare = { species: scene.target, ability: '' };
      const logs = own.map(ability => battleOf(realm, false, scene.move, bare, null, SEEDS[0], bodyOf(ability)));
      if (logs.some(log => !landed(log) || /\|-transform\|/.test(log))) continue;
      const lands = own.map(ability => landed(battleOf(realm, false, scene.move, { species: scene.target, ability: scene.refuser }, null, SEEDS[0], bodyOf(ability))));
      const calm = own.find((_, index) => !lands[index]) ?? own[0];
      const calmIndex = own.indexOf(calm);
      const log = logs[calmIndex];
      const announced = /\|-ability\|p1a: Source\|/.test(log);
      const expected = announced ? !lands[calmIndex] : lands.every(value => !value);
      if (others.length < 2) continue;
      played++;
      if (lands.some(value => value)) ignoring++;
      const ruled = ruledOutOf(log, scene.target).includes(toId(scene.refuser));
      if (ruled !== expected) wrong.push(`${entry.name} (${scene.label}): the attacker's abilities ${lands.map((value, index) => `${own[index]} ${value ? 'lands' : 'refused'}`).join(', ')}; inference ${ruled ? 'rules out' : 'keeps'} ${scene.refuser}${announced ? ' (ability shown)' : ''}`);
    }
  }
  return { wrong, played, ignoring };
}

/** `mayRefuseHit` must keep every ability the twin refuses a hit with; the test also counts what it leaves out. */
export function registerLandedHitSweep(names: string[], shared = false): void {
  const realms = REALMS.filter(realm => names.includes(realm.name));
  if (realms.length !== names.length) throw new Error(`unknown realm among ${names.join(', ')}`);
  describe('every ability of every generation and mod: a landed hit rules out what the simulator refused', () => {
    for (const realm of realms) {
      for (const doubles of [false, true].filter(entry => !entry || FULL || DOUBLES_DEFAULT.includes(realm.name))) {
        test(`${realm.name}, ${doubles ? 'doubles' : 'singles'}: no false rule-out, no unread refusal`, () => {
          const verdict = sweepTargets(realm, doubles);
          expect(verdict.played).toBeGreaterThan(0);
          expect(verdict.refused).toBeGreaterThan(0);
          expect(verdict.falseRuleOuts).toEqual([]);
          expect(verdict.missed).toEqual([]);
          expect(verdict.stalePins).toEqual([]);
        }, 1_800_000);
      }
    }
  });

  const allyRealms = realms.filter(entry => FULL || DOUBLES_DEFAULT.includes(entry.name));
  if (allyRealms.length > 0) describe('the ally\'s ability: what lands on the body next to it rules out the redirects and the guards of the onAlly kind', () => {
    for (const realm of allyRealms) {
      test(`${realm.name}, doubles: no false rule-out, no unread refusal`, () => {
        const verdict = sweepAllies(realm);
        expect(verdict.played).toBeGreaterThan(0);
        expect(verdict.refused).toBeGreaterThan(0);
        expect(verdict.falseRuleOuts).toEqual([]);
        expect(verdict.missed).toEqual([]);
      }, 1_800_000);
    }
  });

  const twinRealms = realms.filter(entry => FULL || DOUBLES_DEFAULT.includes(entry.name) || entry.champions);
  if (twinRealms.length > 0) describe('the twin\'s hit is the played battle\'s hit', () => {
    for (const realm of twinRealms) {
      test(`${realm.name}: effectLands answers what the whole battle answered, for every scene and ability played above`, () => {
        const dex = dexOf(realm);
        const source = sourceOf(realm);
        const disagree: string[] = [];
        let compared = 0;
        for (const pick of speciesPerAbility(dex, sampled({ n: 0 })).values()) {
          for (const scene of scenesOf(realm)) {
            for (const ability of pick.abilities) {
              const base = landsWith(realm, false, scene.move, { species: pick.species, ability: '' }, null, source);
              if (!base) continue;
              const played = landsWith(realm, false, scene.move, { species: pick.species, ability }, null, source);
              const twin = effectLands(dex, {
                target: { species: pick.species, ability }, source: { species: source.species, ability: source.ability }, effect: { kind: 'hit', id: 'hit' }, route: 'primary', move: scene.move,
              });
              compared++;
              if (twin !== null && twin !== played) disagree.push(`${pick.species} ${ability} ${scene.label}: battle ${played}, twin ${twin}`);
            }
          }
        }
        expect(compared).toBeGreaterThan(0);
        expect(disagree).toEqual([]);
      }, 1_800_000);
    }
  });

  describe('the prefilter keeps every ability the twin refuses a hit with', () => {
    if (shared) test('no damaging move of any realm is a powder move, the one hit the simulator\'s Immunity event could refuse (the prefilter leaves Immunity out)', () => {
      for (const realm of REALMS) {
        const dex = dexOf(realm);
        expect(dex.moves.all().filter(move => move.exists && move.gen <= dex.gen && move.flags.powder && move.category !== 'Status').map(move => move.name), realm.name).toEqual([]);
      }
    });

    for (const realm of realms) {
      test(`${realm.name}: no refuser falls outside mayRefuseHit, and the prefilter leaves some abilities out`, () => {
        const dex = dexOf(realm);
        const source = sourceOf(realm);
        const skipped: string[] = [];
        const lost: string[] = [];
        let refusing = 0;
        const ask = (target: SceneBody, partner: SceneBody | undefined, move: string) =>
          effectLands(dex, { target, partner, source: { species: source.species, ability: source.ability }, effect: { kind: 'hit', id: 'hit' }, route: 'primary', move });
        for (const pick of speciesPerAbility(dex, sampled({ n: 0 })).values()) {
          for (const ability of pick.abilities) if (!mayRefuseHit(dex, ability) && !skipped.includes(ability)) skipped.push(ability);
          for (const scene of scenesOf(realm)) {
            for (const ability of pick.abilities) {
              const bodies: [string, SceneBody, SceneBody | undefined, SceneBody, SceneBody | undefined][] = [
                ['target', { species: pick.species, ability: '' }, undefined, { species: pick.species, ability }, undefined],
                ...(scene.spread ? [] : [['ally', { species: REFERENCE, ability: '' }, { species: pick.species, ability: '' }, { species: REFERENCE, ability: '' }, { species: pick.species, ability }] as [string, SceneBody, SceneBody | undefined, SceneBody, SceneBody | undefined]]),
              ];
              for (const [role, bareTarget, barePartner, target, partner] of bodies) {
                if (ask(bareTarget, barePartner, scene.move) !== true) continue;
                if (ask(target, partner, scene.move) !== false) continue;
                refusing++;
                if (!mayRefuseHit(dex, ability)) lost.push(`${pick.species} ${role} ${ability} ${scene.label} (${scene.move})`);
              }
            }
          }
        }
        expect(refusing).toBeGreaterThan(0);
        expect(lost).toEqual([]);
        expect(skipped.length).toBeGreaterThan(0);
      }, 1_800_000);
    }
  });

  const sourceRealms = realms.filter(entry => entry.gen >= 4);
  if (sourceRealms.length > 0) describe('the attacker\'s species decides whether the target\'s ability counts', () => {
    for (const realm of sourceRealms) {
      test(`${realm.name}: the refusing ability is ruled out unless a possible ability of the attacker lets the hit through`, () => {
        const verdict = sweepSources(realm);
        expect(verdict.played).toBeGreaterThan(0);
        expect(verdict.wrong).toEqual([]);
      }, 1_800_000);
    }
  });
}
