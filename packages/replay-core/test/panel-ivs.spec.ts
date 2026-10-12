import { describe, expect, test } from 'vitest';
import { applyInferredSpreads, enrichPokemonInfo, enrichTeamInfo } from '../src/team-info';
import { buildTeamsFromReplay } from '../src/team-builder';
import type { SpreadCandidate } from '../src/spread-inference';
import type { PokemonSetAssumption, SmogonSetAssumptions } from '../src/smogon/sets-lookup';
import type { PokemonEvs, RevealedPokemonInfo } from '../src/types';

/**
 * Round 69 (T136, spec decision 13): the panel and the export show the IVs the build plays. 2663093831's Sinistcha is
 * a Trick Room set (published IV 0 in Attack and Speed): the engine plays it with both, the panel showed nothing and
 * so read as 31. The enrichment reads the IVs of the chosen published set exactly as the build does (the usage spread
 * wins over a marginal set's IVs); a solved candidate's IVs (T132: the Speed IV a seen order takes back) replace them;
 * a Champions body plays IV 31 whatever the set lists. Singles and doubles share one enrichment, the cases run on a
 * singles and a doubles format.
 */
const spread = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): PokemonEvs => ({ hp, atk, def, spa, spd, spe });

const published = (ivs?: PokemonSetAssumption['ivs']): PokemonSetAssumption => ({
  species: 'Sinistcha', sourceDetail: 'Smogon sets',
  item: { value: 'Sitrus Berry', sourceDetail: 'Smogon sets' },
  ability: { value: 'Hospitality', sourceDetail: 'Smogon sets' },
  moves: ['Rage Powder', 'Trick Room', 'Matcha Gotcha', 'Protect'].map(value => ({ value, sourceDetail: 'Smogon sets' })),
  spread: { value: 'Bold', sourceDetail: 'Smogon sets', nature: 'Quiet', evs: spread(252, 0, 4, 252, 0, 0) },
  ...(ivs ? { ivs } : {}),
});
const assumptions = (format: string, entry: PokemonSetAssumption): SmogonSetAssumptions =>
  ({ format, source: 'test', pokemon: { sinistcha: entry } });

const sinistcha = (overrides: Partial<RevealedPokemonInfo> = {}): RevealedPokemonInfo => ({
  species: 'Sinistcha', moves: [], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' }, evs: { value: spread(0, 0, 0, 0, 0, 0), source: 'unknown' },
  level: 100, gender: '', ...overrides,
});

for (const format of ['gen9ou', 'gen9doublesou']) {
  describe(`IVs in the enriched info (${format})`, () => {
    test('a Trick Room set shows its published IVs as a guess', () => {
      const mon = enrichPokemonInfo(sinistcha(), null, assumptions(format, published({ atk: 0, spe: 0 })));
      expect(mon.ivs?.source).toBe('guessed');
      expect(mon.ivs?.value).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 });
    });

    test('a set without IVs leaves the info without IVs', () => {
      expect(enrichPokemonInfo(sinistcha(), null, assumptions(format, published())).ivs).toBeUndefined();
    });

    test('IVs the user set stay', () => {
      const manual = { value: spread(31, 31, 31, 31, 31, 31), source: 'manual' as const };
      const mon = enrichPokemonInfo(sinistcha({ ivs: manual }), null, assumptions(format, published({ atk: 0, spe: 0 })));
      expect(mon.ivs).toEqual(manual);
    });

    test('the info the build reads plays the same IVs as the info shows', () => {
      const log = [
        '|player|p1|Alice|', '|player|p2|Bob|', '|gen|9', `|tier|[Gen 9] ${format === 'gen9ou' ? 'OU' : 'Doubles OU'}`,
        ...(format === 'gen9ou' ? [] : ['|gametype|doubles']),
        '|poke|p1|Garchomp, M|', '|poke|p2|Sinistcha, F|',
      ].join('\n');
      const setAssumptions = assumptions(format, published({ atk: 0, spe: 0 }));
      const built = buildTeamsFromReplay(log, { setAssumptions }).p2Team.find(set => set.species === 'Sinistcha')!;
      const shown = enrichTeamInfo({ pokemon: [sinistcha()] }, null, setAssumptions).pokemon[0];
      expect(shown.ivs?.value).toEqual({ ...{ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...built.ivs });
      expect(built.ivs?.spe).toBe(0);
    });
  });
}

describe('IVs in a Champions format', () => {
  test('the build plays IV 31 whatever the set lists, so the panel shows none', () => {
    const mon = enrichPokemonInfo(sinistcha(), null, assumptions('championsvgc2026', published({ atk: 0 })));
    expect(mon.ivs).toBeUndefined();
  });
});

describe('IVs the solver carries', () => {
  const candidate = (ivs: PokemonEvs): SpreadCandidate => ({ evs: spread(252, 0, 4, 252, 0, 0), nature: 'Quiet', origin: 'order', ivs });

  test('the Speed IV a seen order took back replaces the published one', () => {
    const shown = enrichPokemonInfo(sinistcha(), null, assumptions('gen9ou', published({ atk: 0, spe: 0 })));
    const applied = applyInferredSpreads({ pokemon: [shown] }, 'p1', new Map([['p1:sinistcha', candidate(spread(31, 0, 31, 31, 31, 31))]])).pokemon[0];
    expect(applied.ivs?.source).toBe('guessed');
    expect(applied.ivs?.value).toEqual(spread(31, 0, 31, 31, 31, 31));
  });

  test('a candidate without IVs leaves the shown IVs alone', () => {
    const shown = enrichPokemonInfo(sinistcha(), null, assumptions('gen9ou', published({ atk: 0, spe: 0 })));
    const applied = applyInferredSpreads({ pokemon: [shown] }, 'p1', new Map([['p1:sinistcha', { ...candidate(spread(0, 0, 0, 0, 0, 0)), ivs: undefined }]])).pokemon[0];
    expect(applied.ivs).toEqual(shown.ivs);
  });

  test('IVs the user set are never replaced', () => {
    const manual = { value: spread(31, 31, 31, 31, 31, 31), source: 'manual' as const };
    const applied = applyInferredSpreads({ pokemon: [sinistcha({ ivs: manual })] }, 'p1', new Map([['p1:sinistcha', candidate(spread(31, 0, 31, 31, 31, 0))]])).pokemon[0];
    expect(applied.ivs).toEqual(manual);
  });
});
