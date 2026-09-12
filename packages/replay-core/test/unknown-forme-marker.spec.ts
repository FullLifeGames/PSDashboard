import { test, expect, describe } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildTeamsFromReplay } from '../src/team-builder';

// Team preview hides some formes behind a "-*" marker (Urshifu-*,
// Zamazenta-*, Greninja-*, Arceus-* ...). The battle then reveals the
// forme on the switch line. Round 21 sighted the marker and the revealed
// forme as two team entries (110359 p2: seven sets) — a phantom seventh
// body wherever the bring is not pinned, and one on every singles team.

const urshifuLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|tier|[Gen 9] VGC 2026 Reg I',
  '|clearpoke',
  '|poke|p1|Miraidon, L50|item',
  '|poke|p2|Miraidon, L50|item',
  '|poke|p2|Urshifu-*, L50, M|item',
  '|poke|p2|Incineroar, L50, F|item',
  '|teampreview',
  '|start',
  '|switch|p1a: Miraidon|Miraidon, L50|100/100',
  '|switch|p2a: Miraidon|Miraidon, L50|100/100',
  '|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100',
  '|turn|1',
  '|move|p2b: Urshifu|Surging Strikes|p1a: Miraidon',
  '|-item|p2b: Urshifu|Focus Sash|[from] ability: Frisk|[of] p1a: Miraidon',
  '|turn|2',
].join('\n');

describe('unknown-forme marker from team preview', () => {
  test('the revealed forme takes the marker entry over instead of joining the team as a seventh body', () => {
    const info = inferOpponentTeam(urshifuLog, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    const urshifu = info.pokemon[1];
    // The preview's item marker and the battle's reveals land on the same entry.
    expect(urshifu.item).toEqual(expect.objectContaining({ value: 'Focus Sash', source: 'revealed' }));
    expect(urshifu.moves.map(move => move.name)).toEqual(['Surging Strikes']);
    expect(urshifu.gender).toBe('M');
    expect(urshifu.level).toBe(50);
  });

  test('the base forme itself is a reveal too (Zamazenta without the Rusted Shield)', () => {
    const log = urshifuLog
      .replace('|poke|p2|Urshifu-*, L50, M|item', '|poke|p2|Zamazenta-*, L50|item')
      .replace('|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100', '|switch|p2b: Zamazenta|Zamazenta, L50|100/100')
      .replace('|move|p2b: Urshifu|Surging Strikes|p1a: Miraidon', '|move|p2b: Zamazenta|Body Press|p1a: Miraidon')
      .replace('|-item|p2b: Urshifu|Focus Sash|[from] ability: Frisk|[of] p1a: Miraidon', '');
    const info = inferOpponentTeam(log, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Zamazenta', 'Incineroar']);
    expect(info.pokemon[1].moves.map(move => move.name)).toEqual(['Body Press']);
  });

  test('a marker that never enters the field stays a marker', () => {
    const log = urshifuLog.split('\n').filter(line => !line.includes('p2b: Urshifu')).join('\n');
    const info = inferOpponentTeam(log, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Urshifu-*', 'Incineroar']);
  });

  test('a team sheet names the forme of a marker that never entered the field', () => {
    const sheet = '|showteam|p2|Miraidon||ChoiceSpecs|HadronEngine|ElectroDrift,DracoMeteor,VoltSwitch,Protect|Timid||||50|]' +
      'Urshifu-Rapid-Strike||FocusSash|UnseenFist|SurgingStrikes,CloseCombat,AquaJet,Protect|Jolly||M|||50|]' +
      'Incineroar||SafetyGoggles|Intimidate|FakeOut,KnockOff,FlareBlitz,PartingShot|Careful||F|||50|';
    const log = urshifuLog.split('\n').filter(line => !line.includes('p2b: Urshifu'))
      .map(line => (line === '|teampreview' ? `${sheet}\n|teampreview` : line)).join('\n');
    const info = inferOpponentTeam(log, 'p2');
    expect(info.pokemon.map(pokemon => pokemon.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    expect(info.pokemon[1].moves.map(move => move.name)).toEqual(['Surging Strikes', 'Close Combat', 'Aqua Jet', 'Protect']);
  });

  test('the built team holds six bodies, the revealed forme among them', () => {
    const { p2Team } = buildTeamsFromReplay(urshifuLog);
    expect(p2Team.map(set => set.species)).toEqual(['Miraidon', 'Urshifu-Rapid-Strike', 'Incineroar']);
    expect(p2Team[1].moves).toContain('Surging Strikes');
  });
});
