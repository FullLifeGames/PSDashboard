import { describe, expect, test } from 'vitest';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import {
  ATTACK_BOOSTED, INTIMIDATE_BEFORE_ACTIVATION, KINDS, PARADOX_DEFENDER, QUARK_DRIVE, SWORDS_AFTER_ACTIVATION, scenesOf,
  type Kind, type SceneSpec,
} from './paradox-scenes';

/**
 * Round 69 (T167, spec decision 10): the damage observation names the stat an active Protosynthesis or Quark Drive raises (the
 * client's volatile `protosynthesisatk`, read as inference/hits.ts reads it) and the stat stages the Pokémon had when the ability
 * activated. The simulator picks the stat there (`getBestStat(false, true)` in the ability's start), so a stage that comes later
 * (Swords Dance after the sun) or an Intimidate that came earlier must be read at the activation, not at the hit. The oracle is
 * the simulator's log of real battles on Gen 9 singles and doubles; Champions has no Paradox Pokémon.
 */

const first = (kind: Kind, spec: SceneSpec) => {
  const scene = scenesOf(kind, spec, 1)[0];
  expect(scene).toBeDefined();
  return parseReplayLogWithObservations(scene.log).observations;
};

for (const kind of KINDS) {
  describe(`${kind}: the observation carries the paradox reading`, () => {
    test('a stat raised by Protosynthesis is named with the stages at the activation, not the stages of the hit', () => {
      const observations = first(kind, SWORDS_AFTER_ACTIVATION);
      expect(observations).toHaveLength(2);
      for (const obs of observations) {
        // The sun came with the first lines (Drought), before Swords Dance: Speed was the best stat, with no stage.
        expect(obs.attackerParadox).toMatchObject({ stat: 'spe' });
        expect(obs.attackerParadox?.stages.atk ?? 0).toBe(0);
        expect(obs.attackerBoosts.atk).toBe(2);
        expect(obs.defenderParadox).toBeUndefined();
      }
    });

    test('an Attack boost names atk', () => {
      for (const obs of first(kind, ATTACK_BOOSTED)) expect(obs.attackerParadox?.stat).toBe('atk');
    });

    test('an Intimidate that came before the activation is in the stages', () => {
      const observations = first(kind, INTIMIDATE_BEFORE_ACTIVATION);
      expect(observations).toHaveLength(2);
      for (const obs of observations) {
        expect(obs.attackerParadox).toMatchObject({ stat: 'spe', stages: { atk: -1 } });
        expect(obs.attackerBoosts.atk).toBe(-1);
      }
    });

    test('Quark Drive in an Electric Terrain', () => {
      for (const obs of first(kind, QUARK_DRIVE)) expect(obs.attackerParadox).toMatchObject({ stat: 'atk' });
    });

    test('the Pokémon that is hit carries its reading on the defender side', () => {
      const observations = first(kind, PARADOX_DEFENDER);
      expect(observations.length).toBeGreaterThan(0);
      for (const obs of observations) {
        expect(obs.defenderParadox).toMatchObject({ stat: 'atk' });
        expect(obs.attackerParadox).toBeUndefined();
      }
    });
  });
}

describe('a Pokémon without the ability reads nothing', () => {
  for (const kind of KINDS) {
    test(`${kind}: no fields on a plain hit`, () => {
      const spec: SceneSpec = {
        ...ATTACK_BOOSTED,
        attacker: { ...ATTACK_BOOSTED.attacker, species: 'Garchomp', name: 'Garchomp', ability: 'Rough Skin' },
        lead: { ...ATTACK_BOOSTED.lead, ability: 'Pressure' },
      };
      for (const obs of first(kind, spec)) {
        expect(obs.attackerParadox).toBeUndefined();
        expect(obs.defenderParadox).toBeUndefined();
      }
    });
  }
});
