import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import './champions-mod';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildTeamsFromReplay } from '../src/team-builder';
import { buildSheetSet } from '../src/team/set-resolvers';
import type { RevealedPokemonInfo } from '../src/types';
import type { SpreadCandidate } from '../src/spread-inference';

/**
 * Round 76 (T260): an open team sheet shows no EVs (the `|showteam|` payload has the nature, the item, the moves and no spread),
 * so the EVs of a sheet set are unknown, not zero. The spread solver reads the damage lines and finds them; the sheet set took
 * the usage guess or zeros instead. The scene: gen9championsvgc2026regmbbo3-2634204248 turn 11, where p1's Mawile-Mega stays at
 * 7 % after a Flare Blitz that every roll of a 125 HP Mawile (zero EVs) would knock out; the solver finds 26 HP points (151 HP)
 * and 15 of 16 rolls leave it alive. A sheet that shows real EVs (a pasted team) keeps them.
 */

const replay = JSON.parse(readFileSync(new URL('./fixtures/gen9championsvgc2026regmbbo3-2634204248.json', import.meta.url), 'utf-8')) as { log: string };
const sumOf = (evs: PokemonSet['evs']) => Object.values(evs).reduce((total, value) => total + (value ?? 0), 0);

describe('the scene: gen9championsvgc2026regmbbo3-2634204248 (doubles, Champions VGC)', () => {
  const parsed = parseReplayLogWithObservations(replay.log);
  const teams = buildTeamsFromReplay(replay.log, { observations: parsed.observations, speedOrders: parsed.speedOrders });
  const mawile = teams.p1Team.find(set => set.species === 'Mawile')!;

  test('the sheet shows no EVs, so Mawile takes the solver\'s: about 151 HP, with the sheet\'s nature', () => {
    expect(mawile.nature).toBe('Adamant');
    expect(sumOf(mawile.evs)).toBeGreaterThan(0);
    expect(mawile.evs.hp).toBeGreaterThanOrEqual(20);
  });

  test('every sheet set keeps the sheet\'s nature and item', () => {
    expect(teams.p2Team.find(set => set.species === 'Incineroar')).toMatchObject({ nature: 'Impish', item: 'Sitrus Berry' });
    expect(teams.p1Team.find(set => set.species === 'Incineroar')).toMatchObject({ nature: 'Careful', item: 'Chople Berry' });
  });
});

const info = (species: string) => ({
  species, moves: [{ name: 'Tackle', source: 'revealed' }], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' }, evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 50, gender: 'M',
}) as unknown as RevealedPokemonInfo;
const sheet = (evs: PokemonSet['evs']): PokemonSet => ({
  name: 'Mawile', species: 'Mawile', item: 'Mawilite', ability: 'Intimidate', moves: ['Protect'], nature: 'Adamant', evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: 'M',
});
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const SOLVED: SpreadCandidate = { evs: { hp: 26, atk: 32, def: 0, spa: 0, spd: 8, spe: 0 }, nature: 'Hardy', origin: 'damage' };

describe('buildSheetSet with a solved spread (the rule is format-free: singles and doubles read it alike)', () => {
  test('a sheet without EVs takes the solved EVs and keeps its nature', () => {
    const set = buildSheetSet(info('Mawile'), sheet(ZERO), { editedEvs: null, editedNature: null, editedIvs: null }, null, null, SOLVED);
    expect(set.evs).toEqual(SOLVED.evs);
    expect(set.nature).toBe('Adamant');
  });

  test('a sheet with real EVs keeps them', () => {
    const real = { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 };
    expect(buildSheetSet(info('Mawile'), sheet(real), { editedEvs: null, editedNature: null, editedIvs: null }, null, null, SOLVED).evs).toEqual(real);
  });

  test('edited EVs win over the solver; a guess of the solver (origin prior) does not replace the usage fallback', () => {
    const edited = { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    expect(buildSheetSet(info('Mawile'), sheet(ZERO), { editedEvs: edited, editedNature: null, editedIvs: null }, null, null, SOLVED).evs).toEqual(edited);
    const usage = { spread: { nature: 'Jolly', evs: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } } } as never;
    expect(buildSheetSet(info('Mawile'), sheet(ZERO), { editedEvs: null, editedNature: null, editedIvs: null }, usage, null, { ...SOLVED, origin: 'prior' }).evs)
      .toEqual({ hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 });
  });
});
