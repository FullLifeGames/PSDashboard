import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { analyzeLeads, leadSpeciesOf, matchLeadOption } from '../src/lib/eval/leads';
import { parseLeadSpecies } from '../src/lib/eval/played';
import type { EvalResult, RankedChoice } from '../src/lib/eval/types';

const option = (choice: string, label: string, ev: number): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: 'Lead X + Y' });

const leadResult: EvalResult = {
  score: 0.1, interval: 0, depthCompleted: 1,
  perSide: {
    p1: [
      option('team 12', 'Lead Scizor + Sneasler', 0.3),
      option('team 13', 'Lead Scizor + Eelektross', 0.1),
      option('team 23', 'Lead Sneasler + Eelektross', -0.1),
    ],
    p2: [
      option('team 12', 'Lead Grimmsnarl + Annihilape', -0.1),
      option('team 13', 'Lead Grimmsnarl + Politoed', -0.3),
    ],
  },
};

test.describe('lead (turn 0) analysis', () => {
  test('lead labels parse and match as unordered sets', () => {
    expect(leadSpeciesOf('Lead Scizor + Sneasler')).toEqual(['Scizor', 'Sneasler']);
    expect(leadSpeciesOf('Lead Heatran')).toEqual(['Heatran']);
    // The replay may show the pair in the other slot order — still a match.
    expect(matchLeadOption(leadResult.perSide.p1, ['Sneasler', 'Scizor'])?.choice).toBe('team 12');
    expect(matchLeadOption(leadResult.perSide.p1, ['Scizor', 'Politoed'])).toBeNull();
    expect(matchLeadOption(leadResult.perSide.p1, null)).toBeNull();
  });

  test('analyzeLeads grades the played pair against the best by ev', () => {
    const analysis = analyzeLeads(leadResult, { p1: ['Sneasler', 'Eelektross'], p2: ['Grimmsnarl', 'Annihilape'] });
    expect(analysis.p1.played?.choice).toBe('team 23');
    expect(analysis.p1.best?.choice).toBe('team 12');
    expect(analysis.p1.regret).toBeCloseTo(0.4, 10);
    expect(analysis.p1.tier).toBe('blunder');
    expect(analysis.p2.regret).toBeCloseTo(0, 10);
    expect(analysis.p2.tier).toBeUndefined();
  });

  test('parseLeadSpecies reads the leads from the start block only', () => {
    const log = [
      '|player|p1|Alice|', '|player|p2|Bob|', '|gametype|doubles', '|start',
      '|switch|p1a: Sciz|Scizor, M|100/100', '|switch|p1b: Sneas|Sneasler, F|100/100',
      '|switch|p2a: Grimm|Grimmsnarl, M|100/100', '|switch|p2b: Ape|Annihilape|100/100',
      '|turn|1',
      '|switch|p1a: Muk|Muk-Alola|100/100',
    ].join('\n');
    const leads = parseLeadSpecies(log);
    expect(leads.p1).toEqual(['Scizor', 'Sneasler']);
    expect(leads.p2).toEqual(['Grimmsnarl', 'Annihilape']);
  });

  test('serializePreviewPosition yields a searchable turn-0 position (or null without preview)', async () => {
    const { serializePreviewPosition } = await import('../src/lib/branch-engine');
    const { createRootPosition, legalChoices } = await import('../src/lib/eval/forward-model');
    const set = (species: string): PokemonSet => ({
      name: species, species, item: '', ability: 'No Ability', moves: ['Tackle'],
      nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 50, gender: '',
    });
    const team = [set('Scizor'), set('Sneasler'), set('Eelektross'), set('Sinistcha')];
    const serialized = serializePreviewPosition('gen9doublesou', team, team);
    expect(serialized).not.toBeNull();
    const options = legalChoices(createRootPosition(serialized!), 'p1');
    expect(options).toHaveLength(6);
    expect(options[0].choice).toMatch(/^team /);
    // Formats without team preview produce no turn 0.
    expect(serializePreviewPosition('gen3customgame', team, team)).toBeNull();
  });

  test('clause-suffixed singles formats keep their team preview (draft replays)', async () => {
    // Draft replays branch as "gen9customgame@@@Sleep Clause Mod" — running
    // the format string through toID mangled the custom rules into an
    // unknown format with no preview, so every draft game silently lost its
    // turn-0 evaluation (the graph's missing T0 diamond in singles).
    const { serializePreviewPosition } = await import('../src/lib/branch-engine');
    const { createRootPosition, legalChoices } = await import('../src/lib/eval/forward-model');
    const set = (species: string): PokemonSet => ({
      name: species, species, item: '', ability: 'No Ability', moves: ['Tackle'],
      nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100, gender: '',
    });
    const team = [set('Garchomp'), set('Rotom-Wash'), set('Skarmory')];
    const serialized = serializePreviewPosition('gen9customgame@@@Sleep Clause Mod', team, team);
    expect(serialized).not.toBeNull();
    const options = legalChoices(createRootPosition(serialized!), 'p1');
    expect(options).toHaveLength(3);
    expect(options.map(option => option.label)).toContain('Lead Garchomp');
  });
});
