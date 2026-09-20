import { test, expect, describe } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { getMainChoice } from '../src/branch/protocol-choices';

/**
 * Round 54 (T57): a Tera turn without an action line for the slot. The
 * player clicked Tera, the body flinched before it moved, and the protocol
 * carries only a reason-only |cant|. The scan fell through to the default
 * move WITHOUT the gimmick suffix: 8 of 207 Tera clicks over the bank's 129
 * replays, 13 bank positions one Tera body short (gen9vgc2026regi-2629760324
 * t1, Zamazenta into Fake Out). The sim resolves Tera before any move runs,
 * so the click lands although the body then flinches. Asserted on the
 * marker, never on the error count: a locked or Struggling body swallows
 * the suffix without an error.
 */

describe('a gimmick click on a turn without an action line (round 54)', () => {
  test('replays a Terastallization on a turn the body flinched out of its move', async () => {
    const set = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
      name: species, species, item: '', ability, moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
      teraType,
    });
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] OU',
      '|poke|p1|Snorlax, M|',
      '|poke|p2|Hitmontop, M|',
      '|start',
      '|switch|p1a: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|turn|1',
      '|-terastallize|p1a: Snorlax|Water',
      '|move|p2a: Hitmontop|Fake Out|p1a: Snorlax',
      '|-damage|p1a: Snorlax|95/100',
      '|cant|p1a: Snorlax|flinch',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team: [set('Snorlax', 'Immunity', ['Tackle', 'Rest'], 'Water')],
      p2Team: [set('Hitmontop', 'Technician', ['Fake Out', 'Close Combat'], 'Fighting')],
      replayLog: log,
      targetTurn: 2,
    });
    const snorlax = runtime.battleStream.battle!.sides[0].active[0]!;
    expect(snorlax.terastallized).toBe('Water');
    expect(snorlax.canTerastallize).toBeFalsy();
  });

  test('doubles: the flinched slot terastallizes, its partner does not', async () => {
    const set = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
      name: species, species, item: '', ability, moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
      teraType,
    });
    const log = [
      '|gametype|doubles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Blissey, F|',
      '|poke|p1|Snorlax, M|',
      '|poke|p2|Hitmontop, M|',
      '|poke|p2|Chansey, F|',
      '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p1b: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|switch|p2b: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|-terastallize|p1b: Snorlax|Water',
      '|move|p2a: Hitmontop|Fake Out|p1b: Snorlax',
      '|-damage|p1b: Snorlax|95/100',
      '|move|p1a: Blissey|Seismic Toss|p2a: Hitmontop',
      '|-damage|p2a: Hitmontop|70/100',
      '|cant|p1b: Snorlax|flinch',
      '|move|p2b: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|85/100',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: [set('Blissey', 'Natural Cure', ['Seismic Toss'], 'Fairy'), set('Snorlax', 'Immunity', ['Tackle', 'Rest'], 'Water')],
      p2Team: [set('Hitmontop', 'Technician', ['Fake Out', 'Close Combat'], 'Fighting'), set('Chansey', 'Natural Cure', ['Seismic Toss'], 'Fairy')],
      replayLog: log,
      targetTurn: 2,
    });
    const [blissey, snorlax] = runtime.battleStream.battle!.sides[0].active;
    expect(snorlax!.terastallized).toBe('Water');
    expect(blissey!.terastallized).toBeFalsy();
    expect(runtime.choiceErrors.count).toBe(0);
  });

  test('a Mega Evolution on a flinched turn is replayed the same way', async () => {
    const set = (species: string, moves: string[], item = ''): PokemonSet => ({
      name: species, species, item, ability: '', moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
    });
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|7',
      '|tier|[Gen 7] OU',
      '|poke|p1|Scizor, M|',
      '|poke|p2|Hitmontop, M|',
      '|start',
      '|switch|p1a: Scizor|Scizor, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|turn|1',
      '|detailschange|p1a: Scizor|Scizor-Mega, M',
      '|-mega|p1a: Scizor|Scizor|Scizorite',
      '|move|p2a: Hitmontop|Fake Out|p1a: Scizor',
      '|-damage|p1a: Scizor|95/100',
      '|cant|p1a: Scizor|flinch',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen7ou',
      p1Team: [{ ...set('Scizor', ['Bullet Punch'], 'Scizorite'), ability: 'Technician' }],
      p2Team: [{ ...set('Hitmontop', ['Fake Out', 'Close Combat']), ability: 'Technician' }],
      replayLog: log,
      targetTurn: 2,
    });
    const scizor = runtime.battleStream.battle!.sides[0].active[0]!;
    expect(scizor.species.name).toBe('Scizor-Mega');
  });

  // `pass` takes no modifier: the sim rejects "pass terastallize", and a
  // rejected side choice is answered with its default for BOTH slots. The
  // state needs a fainted active whose side still holds its Tera, which only
  // doubles with an empty bench produces (a singles side with a fainted
  // active gets a forced switch, or the battle ends).
  test('a fainted slot passes without a gimmick suffix', async () => {
    const set = (species: string, moves: string[], level: number): PokemonSet => ({
      name: species, species, item: '', ability: '', moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level,
      teraType: 'Water',
    });
    const log = [
      '|gametype|doubles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Blissey, F|',
      '|poke|p1|Snorlax, L1, M|',
      '|poke|p2|Hitmontop, M|',
      '|poke|p2|Chansey, F|',
      '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p1b: Snorlax|Snorlax, L1, M|100/100',
      '|switch|p2a: Hitmontop|Hitmontop, M|100/100',
      '|switch|p2b: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|move|p2a: Hitmontop|Close Combat|p1b: Snorlax',
      '|-damage|p1b: Snorlax|0 fnt',
      '|faint|p1b: Snorlax',
      '|move|p1a: Blissey|Seismic Toss|p2a: Hitmontop',
      '|-damage|p2a: Hitmontop|70/100',
      '|move|p2b: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|85/100',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: [set('Blissey', ['Seismic Toss'], 100), set('Snorlax', ['Tackle'], 1)],
      p2Team: [set('Hitmontop', ['Close Combat', 'Fake Out'], 100), set('Chansey', ['Seismic Toss'], 100)],
      replayLog: log,
      targetTurn: 2,
    });
    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].active[1]!.fainted).toBe(true);
    expect(battle.sides[0].active[1]!.canTerastallize).toBeTruthy();
    expect(getMainChoice(['|-terastallize|p1b: Snorlax|Water'], 'p1', battle).split(', ')[1]).toBe('pass');
  });
});
