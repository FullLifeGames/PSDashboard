import { describe, expect, test } from 'vitest';
import { Dex, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation } from '../src/types';
import { FORMAT, damagingTurns, scaled, scenesOf, set, type FieldScene, type Kind, type Scene } from './fit-field-scenes';

/**
 * Round 73 (T203): a field ability of the partner moves the damage of a doubles hit, and the log rarely shows it. Battery, Power
 * Spot and Steely Spirit of the attacker's partner and Friend Guard of the defender's partner print nothing. The solver priced the
 * hit without them (Charjabug next to Garchomp, Clefairy next to Blissey). The observation names the partner; its shown ability
 * counts, a species with one ability has that ability by the Dex, and any other species has the ability of its built set (the
 * build's guess, as the item and the spread already are). Flower Gift of a Cherrim in sun is shown by the forme change and reaches
 * the calculator through the same tables. The oracle is the simulator's own damage; singles has no partner, and the Champions roster
 * holds none of these species (the census spec states it).
 */

/** The attacker's offense stat is the move's, within the 510 EVs (66 Stat Points) of every format. */
const GARCHOMP = (move: string) => set('Garchomp', '', 'Rough Skin', [move, 'Splash'], 'Hardy', { hp: 252, [Dex.moves.get(move).category === 'Special' ? 'spa' : 'atk']: 252 });
/** A weak attacker: under the boost of Flower Gift the strong one would knock out the Blissey. */
const WEAK_GARCHOMP = (move: string) => set('Garchomp', '', 'Rough Skin', [move, 'Splash'], 'Hardy', { hp: 252 });
const BLISSEY = () => set('Blissey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252, spd: 252 });
const CHANSEY = () => set('Chansey', '', 'Natural Cure', ['Splash'], 'Calm', { hp: 252 });
const splashing = (species: string, ability: string, extra: string[] = []) => set(species, '', ability, ['Splash', ...extra], 'Hardy', { hp: 252 });

interface PartnerScene extends FieldScene {
  /** The sets the solver gets: the attacker, the defender and the partner whose ability is a guess, by side. */
  solverSets: () => { p1: PokemonSet[]; p2: PokemonSet[] };
  /** The fact the partner books, by its id. */
  fact: string;
  /** The side the partner stands on. */
  partnerSide: 'attacker' | 'defender';
}

const hit = (move: string, doubles: boolean) => (doubles ? `move ${move} 1, move splash` : `move ${move}`);
const idle = 'move splash, move splash';

const attackerPartner = (title: string, partner: PokemonSet, move: string, fact: string, solverPartner: boolean, attacker = GARCHOMP(move)): PartnerScene => {
  return {
    title, p1: () => [attacker, partner], p2: () => [BLISSEY(), CHANSEY()], attacker: 'Garchomp', defender: 'Blissey',
    steps: () => [{ p1: hit(move.toLowerCase().replace(/\s/g, ''), true), p2: idle }], kinds: ['doubles'],
    solverSets: () => ({ p1: solverPartner ? [attacker, partner] : [attacker], p2: [BLISSEY()] }), fact, partnerSide: 'attacker',
  };
};

const SCENES: PartnerScene[] = [
  attackerPartner('Battery of Charjabug, a species with one ability', splashing('Charjabug', 'Battery'), 'Dragon Pulse', 'battery', false),
  attackerPartner('Power Spot of Stonjourner, a species with one ability', splashing('Stonjourner', 'Power Spot'), 'Dragon Claw', 'powerspot', false, WEAK_GARCHOMP('Dragon Claw')),
  attackerPartner('Steely Spirit of Perrserker, a species with several abilities: its set decides', splashing('Perrserker', 'Steely Spirit'), 'Iron Head', 'steelyspirit', true),
  {
    title: 'Friend Guard of Clefairy next to the defender, a species with several abilities: its set decides',
    p1: () => [GARCHOMP('Dragon Pulse'), CHANSEY()], p2: () => [BLISSEY(), splashing('Clefairy', 'Friend Guard')], attacker: 'Garchomp', defender: 'Blissey',
    steps: () => [{ p1: hit('dragonpulse', true), p2: idle }], kinds: ['doubles'],
    solverSets: () => ({ p1: [GARCHOMP('Dragon Pulse')], p2: [BLISSEY(), splashing('Clefairy', 'Friend Guard')] }), fact: 'friendguard', partnerSide: 'defender',
  },
  {
    title: 'Flower Gift of a Cherrim in sun, shown by its forme change, beside the attacker',
    p1: () => [WEAK_GARCHOMP('Dragon Claw'), splashing('Cherrim', 'Flower Gift')], p2: () => [BLISSEY(), splashing('Torkoal', 'Drought')], attacker: 'Garchomp', defender: 'Blissey',
    steps: () => [{ p1: hit('dragonclaw', true), p2: idle }], kinds: ['doubles'],
    solverSets: () => ({ p1: [WEAK_GARCHOMP('Dragon Claw')], p2: [BLISSEY()] }), fact: 'flowergift', partnerSide: 'attacker',
  },
  {
    title: 'Friend Guard of Vivillon next to the defender (the one Champions family with a partner ability)',
    p1: () => [GARCHOMP('Dragon Pulse'), CHANSEY()], p2: () => [BLISSEY(), splashing('Vivillon', 'Friend Guard')], attacker: 'Garchomp', defender: 'Blissey',
    steps: () => [{ p1: hit('dragonpulse', true), p2: idle }], kinds: ['doubles', 'champions doubles'],
    solverSets: () => ({ p1: [GARCHOMP('Dragon Pulse')], p2: [BLISSEY(), splashing('Vivillon', 'Friend Guard')] }), fact: 'friendguard', partnerSide: 'defender',
  },
  {
    title: 'Flower Gift of a Cherrim in sun beside the defender',
    p1: () => [GARCHOMP('Dragon Pulse'), splashing('Torkoal', 'Drought')], p2: () => [BLISSEY(), splashing('Cherrim', 'Flower Gift')], attacker: 'Garchomp', defender: 'Blissey',
    steps: () => [{ p1: hit('dragonpulse', true), p2: idle }], kinds: ['doubles'],
    solverSets: () => ({ p1: [GARCHOMP('Dragon Pulse')], p2: [BLISSEY()] }), fact: 'defenderflowergift', partnerSide: 'defender',
  },
];

function contextOf(scene: PartnerScene, kind: Kind, observations: DamageObservation[]): SolveContext {
  const sets = scene.solverSets();
  return buildSolveContext(observations, { p1: sets.p1.map(body => scaled(body, kind)), p2: sets.p2.map(body => scaled(body, kind)) }, FORMAT[kind], []);
}


function hitsOf(scene: PartnerScene, played: Scene): DamageObservation[] {
  const found = parseReplayLogWithObservations(played.log).observations.filter(obs => obs.defenderSpecies === scene.defender && obs.attackerSpecies === scene.attacker);
  expect(found).toHaveLength(damagingTurns(played).length);
  return found;
}

const readsOf = (ctx: SolveContext, scene: PartnerScene): ReadObservation[] => ctx.byMon.get(keyOf('p2', scene.defender)) ?? [];

function containsDamage(ctx: SolveContext, scene: PartnerScene, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', scene.attacker), spreadFor(ctx, 'p2', scene.defender));
  expect(range).not.toBeNull();
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

/** The observation as the solver read it before T203: no partner reading, no partner fact. */
const stale = (obs: ReadObservation, fact: string): ReadObservation => {
  const rest: Record<string, unknown> = { ...obs };
  for (const field of ['attackerAlly', 'defenderAlly', 'attackerAllyAbility', 'defenderAllyAbility']) delete rest[field];
  return { ...(rest as unknown as ReadObservation), fieldFacts: (obs.fieldFacts ?? []).filter(id => id !== fact) };
};

describe('the partner field ability reaches the calculator (doubles)', () => {
  for (const scene of SCENES) {
    for (const kind of scene.kinds) {
      test(`${kind}: ${scene.title}`, () => {
        const scenes = scenesOf(kind, scene, 3);
        expect(scenes.length).toBeGreaterThanOrEqual(2);
        for (const played of scenes) {
          const observations = hitsOf(scene, played);
          const ctx = contextOf(scene, kind, observations);
          const reads = readsOf(ctx, scene);
          expect(reads).toHaveLength(observations.length);
          const damages = damagingTurns(played);
          const spread = spreadFor(ctx, 'p2', scene.defender);
          reads.forEach((obs, index) => {
            expect(obs.fieldFacts ?? [], 'the fact the partner books').toContain(scene.fact);
            expect(containsDamage(ctx, scene, obs, damages[index], played.maxHp), `hit ${index + 1}`).toBe(true);
            expect(observationError(ctx, obs, keyOf('p2', scene.defender), spread)).toBe(0);
          });
          // Read without the partner, at least one hit misses the simulator's damage: the scene shows something.
          expect(reads.some((obs, index) => !containsDamage(ctx, scene, stale(obs, scene.fact), damages[index], played.maxHp)), 'a hit the stale reading misses').toBe(true);
        }
      });
    }
  }

  test('the observation names the partner, with its ability only when the log showed it', () => {
    const battery = SCENES[0];
    const friendGuard = SCENES[3];
    const [played] = scenesOf('doubles', battery, 1);
    expect(hitsOf(battery, played)[0].attackerAlly).toMatchObject({ species: 'Charjabug', unrevealed: true });
    const [guarded] = scenesOf('doubles', friendGuard, 1);
    const [obs] = hitsOf(friendGuard, guarded);
    expect(obs.defenderAlly).toMatchObject({ species: 'Clefairy', unrevealed: true });
    expect(obs.attackerAlly?.species).toBe('Chansey');
  });
});

describe('a partner with a hidden ability that is no field ability changes nothing', () => {
  test('doubles: Chansey beside the attacker books no fact', () => {
    const scene = SCENES[3];
    const [played] = scenesOf('doubles', scene, 1);
    const ctx = contextOf(scene, 'doubles', hitsOf(scene, played));
    expect((readsOf(ctx, scene)[0].fieldFacts ?? []).filter(id => id !== 'friendguard')).toEqual([]);
  });
});
