import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * Battle-only formes join the body they came from (round 63, T101). The Dex
 * names the origin (`battleOnly`): a string for Mimikyu-Busted or
 * Palafin-Hero, a list for Zygarde-Complete and Necrozma-Ultra, where the
 * team decides. The hand-kept suffix list knew none of these, so a later
 * switch-in made a seventh body (27 sides in the fit corpus).
 */

function log(gen: number, species: [string, string][], lines: string[], doubles = false): string {
  return [
    '|player|p1|Alice|', '|player|p2|Bob|', ...(doubles ? ['|gametype|doubles'] : []), `|gen|${gen}`, '|tier|test',
    '|poke|p1|Skarmory|', ...species.map(([preview]) => `|poke|p2|${preview}|`), '|start',
    '|switch|p1a: Skarmory|Skarmory|100/100', ...lines,
  ].join('\n');
}

const team = (text: string) => inferOpponentTeam(text, 'p2').pokemon;
const movesOf = (text: string, species: string) =>
  team(text).find(mon => mon.species === species)?.moves.map(move => move.name);

describe('a battle-only forme on a later switch-in is the same body (T101)', () => {
  test('singles: Mimikyu-Busted joins Mimikyu, the moves after the change book on it', () => {
    const text = log(9, [['Mimikyu, F', ''], ['Heatran', '']], [
      '|switch|p2a: Kyu|Mimikyu, F|100/100', '|turn|1', '|move|p2a: Kyu|Play Rough|p1a: Skarmory',
      '|detailschange|p2a: Kyu|Mimikyu-Busted, F', '|turn|2', '|switch|p2a: Tran|Heatran|100/100', '|turn|3',
      '|switch|p2a: Kyu|Mimikyu-Busted, F|88/100', '|turn|4', '|move|p2a: Kyu|Shadow Claw|p1a: Skarmory',
    ]);
    expect(team(text).map(mon => mon.species)).toEqual(['Mimikyu', 'Heatran']);
    expect(movesOf(text, 'Mimikyu')).toEqual(['Play Rough', 'Shadow Claw']);
  });

  test('singles: Zygarde-Complete joins the Zygarde-10% the preview showed (a list in the Dex)', () => {
    const text = log(7, [['Zygarde-10%', ''], ['Heatran', '']], [
      '|switch|p2a: Zyg|Zygarde-10%|100/100', '|turn|1', '|detailschange|p2a: Zyg|Zygarde-Complete',
      '|switch|p2a: Tran|Heatran|100/100', '|turn|2', '|switch|p2a: Zyg|Zygarde-Complete|50/100', '|turn|3',
      '|move|p2a: Zyg|Thousand Arrows|p1a: Skarmory',
    ]);
    expect(team(text).map(mon => mon.species)).toEqual(['Zygarde-10%', 'Heatran']);
    expect(movesOf(text, 'Zygarde-10%')).toEqual(['Thousand Arrows']);
  });

  test('singles: Necrozma-Ultra joins Necrozma-Dusk-Mane, not a new "Necrozma"', () => {
    const text = log(7, [['Necrozma-Dusk-Mane', ''], ['Heatran', '']], [
      '|switch|p2a: Nec|Necrozma-Dusk-Mane|100/100', '|turn|1', '|-burst|p2a: Nec|Necrozma-Ultra|Ultranecrozium Z',
      '|detailschange|p2a: Nec|Necrozma-Ultra', '|switch|p2a: Tran|Heatran|100/100', '|turn|2',
      '|switch|p2a: Nec|Necrozma-Ultra|70/100', '|turn|3',
    ]);
    expect(team(text).map(mon => mon.species)).toEqual(['Necrozma-Dusk-Mane', 'Heatran']);
  });

  test('singles: Greninja-Ash joins the Greninja the preview showed (same Dex number)', () => {
    const text = log(7, [['Greninja', ''], ['Heatran', '']], [
      '|switch|p2a: Gren|Greninja|100/100', '|turn|1', '|detailschange|p2a: Gren|Greninja-Ash',
      '|switch|p2a: Tran|Heatran|100/100', '|turn|2', '|switch|p2a: Gren|Greninja-Ash|60/100', '|turn|3',
    ]);
    expect(team(text).map(mon => mon.species)).toEqual(['Greninja', 'Heatran']);
  });

  test('doubles: Palafin-Hero joins Palafin', () => {
    const text = log(9, [['Palafin, M', ''], ['Heatran', ''], ['Amoonguss', '']], [
      '|switch|p1b: Skarmory|Skarmory|100/100', '|switch|p2a: Fin|Palafin, M|100/100', '|switch|p2b: Tran|Heatran|100/100', '|turn|1',
      '|switch|p2a: Goss|Amoonguss|100/100', '|turn|2', '|switch|p2a: Fin|Palafin-Hero, M|100/100', '|turn|3',
      '|move|p2a: Fin|Jet Punch|p1a: Skarmory',
    ], true);
    expect(team(text).map(mon => mon.species)).toEqual(['Palafin', 'Heatran', 'Amoonguss']);
    expect(movesOf(text, 'Palafin')).toEqual(['Jet Punch']);
  });

  test('a forme the preview names itself stays (gen 8 Zacian-Crowned)', () => {
    const text = log(8, [['Zacian-Crowned', ''], ['Heatran', '']], [
      '|switch|p2a: Zac|Zacian-Crowned|100/100', '|turn|1', '|move|p2a: Zac|Behemoth Blade|p1a: Skarmory',
    ]);
    expect(team(text).map(mon => mon.species)).toEqual(['Zacian-Crowned', 'Heatran']);
  });
});
