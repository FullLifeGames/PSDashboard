import { test, expect, describe } from 'vitest';
import { createBranchState, reconstructBranchRuntime, serializePreviewPosition } from '../src/branch-engine';
import { getReplayBringCount, replayBringOnly, parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import type { PokemonSet } from '@pkmn/sim';

function mon(name: string, move: string): PokemonSet {
  return {
    name,
    species: name,
    item: '',
    ability: '',
    moves: [move, 'Protect'],
    nature: 'Serious',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
  };
}

const p1Team: PokemonSet[] = [
  mon('Pikachu', 'Thunderbolt'), mon('Eevee', 'Tackle'), mon('Raichu', 'Thunderbolt'),
  mon('Jolteon', 'Thunderbolt'), mon('Flareon', 'Ember'), mon('Vaporeon', 'Water Gun'),
];
const p2Team: PokemonSet[] = [
  mon('Bulbasaur', 'Vine Whip'), mon('Charmander', 'Ember'), mon('Squirtle', 'Water Gun'),
  mon('Ivysaur', 'Vine Whip'), mon('Charmeleon', 'Ember'), mon('Wartortle', 'Water Gun'),
];

const vgcLog = [
  '|player|p1|Alice|',
  '|player|p2|Bob|',
  '|gametype|doubles',
  '|gen|9',
  '|teampreview',
  '|start',
  '|switch|p1a: Pikachu|Pikachu, L50|100/100',
  '|switch|p1b: Eevee|Eevee, L50|100/100',
  '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
  '|switch|p2b: Charmander|Charmander, L50|100/100',
  '|turn|1',
].join('\n');

describe('bring-limited team preview (VGC 4 of 6)', () => {
  test('getReplayBringCount answers from the rule table and the format-id heuristic', () => {
    // Regulations newer than the bundled sim resolve via the heuristic.
    expect(getReplayBringCount({ formatid: 'gen9vgc2026regi' })).toBe(4);
    // A regulation the Dex knows answers from its own rule table.
    expect(getReplayBringCount({ formatid: 'gen9vgc2025regi' })).toBe(4);
    expect(getReplayBringCount({ formatid: 'gen9battlestadiumsinglesregi' })).toBe(3);
    // Bring-all formats have no limit.
    expect(getReplayBringCount({ formatid: 'gen9ou' })).toBe(null);
    expect(getReplayBringCount({ formatid: 'gen9doublesou' })).toBe(null);
  });

  test('bringOnly fields exactly the brought four with the chosen leads first', async () => {
    const logLines: string[] = [];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      onLogLines: lines => logLines.push(...lines),
      leadOverride: { p1: ['Raichu', 'Jolteon'], p2: ['Squirtle', 'Ivysaur'] },
      bringOnly: {
        p1: ['Raichu', 'Jolteon', 'Pikachu', 'Eevee'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(4);
    expect(battle.sides[1].pokemon).toHaveLength(4);
    expect(battle.sides[0].pokemon.map(pokemon => pokemon.species.name)).not.toContain('Flareon');

    const state = createBranchState(runtime.battleStream, logLines, {
      p1Choices: [null, null],
      p2Choices: [null, null],
    });
    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Raichu', 'Jolteon']);
    expect(state.p2ActiveSlots.map(active => active?.species)).toEqual(['Squirtle', 'Ivysaur']);
    // The bench holds ONLY the rest of the brought four.
    expect(state.p1SwitchesBySlot[0].map(option => option.species).sort()).toEqual(['Eevee', 'Pikachu']);
  });

  test('a bring list the team cannot satisfy fails open to the whole team', async () => {
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Raichu', 'Jolteon', 'Pikachu', 'Mewtwo'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.sides[0].pokemon).toHaveLength(6);
    expect(battle.sides[1].pokemon).toHaveLength(4);
  });

  test('replayBringOnly pins both sides or neither and dedupes battle formes', () => {
    // A forme change mid-game (Terapagos-Terastal → -Stellar) is ONE brought
    // body (the VGC-tranche sighting caught it counted twice). A side whose
    // fourth never entered leaves the WHOLE replay unpinned: the A/B gate
    // showed a pinned four against an unpinned six flips games (452654).
    const log = [
      '|player|p1|Alice|',
      '|player|p2|Bob|',
      '|gametype|doubles',
      '|gen|9',
      '|tier|[Gen 9] VGC 2026 Regulation I',
      '|poke|p1|Terapagos, L50|',
      '|poke|p1|Pikachu, L50|',
      '|poke|p1|Eevee, L50|',
      '|poke|p1|Raichu, L50|',
      '|poke|p1|Jolteon, L50|',
      '|poke|p1|Flareon, L50|',
      '|poke|p2|Bulbasaur, L50|',
      '|poke|p2|Charmander, L50|',
      '|poke|p2|Squirtle, L50|',
      '|poke|p2|Ivysaur, L50|',
      '|poke|p2|Charmeleon, L50|',
      '|poke|p2|Wartortle, L50|',
      '|teampreview',
      '|start',
      '|switch|p1a: Terapagos|Terapagos-Terastal, L50|100/100',
      '|switch|p1b: Pikachu|Pikachu, L50|100/100',
      '|switch|p2a: Bulbasaur|Bulbasaur, L50|100/100',
      '|switch|p2b: Charmander|Charmander, L50|100/100',
      '|turn|1',
      '|switch|p1a: Terapagos|Terapagos-Stellar, L50|100/100',
      '|switch|p1b: Eevee|Eevee, L50|100/100',
      '|switch|p2a: Squirtle|Squirtle, L50|100/100',
      '|turn|2',
      '|switch|p1a: Raichu|Raichu, L50|100/100',
      '|turn|3',
    ].join('\n');
    const { snapshots } = parseReplayLogWithObservations(log);
    // p2's fourth never entered — the whole replay stays unpinned.
    expect(replayBringOnly({ formatid: 'gen9vgc2026regi', log }, snapshots)).toBeNull();

    // With p2's fourth revealed, both sides pin — and Terapagos counts once
    // (first-seen forme name) despite entering as two formes.
    const fullLog = `${log}\n|switch|p2b: Ivysaur|Ivysaur, L50|100/100\n|turn|4`;
    const fullSnapshots = parseReplayLogWithObservations(fullLog).snapshots;
    const brought = replayBringOnly({ formatid: 'gen9vgc2026regi', log: fullLog }, fullSnapshots);
    expect(brought).not.toBeNull();
    expect([...brought!.p1].sort()).toEqual(['Eevee', 'Pikachu', 'Raichu', 'Terapagos-Terastal']);
    expect([...brought!.p2].sort()).toEqual(['Bulbasaur', 'Charmander', 'Ivysaur', 'Squirtle']);
    // Bring-all formats never produce a bring list.
    expect(replayBringOnly({ formatid: 'gen9doublesou', log: fullLog }, fullSnapshots)).toBeNull();
  });

  test('brought forme names resolve onto their base-species sets, exact match first', async () => {
    // The protocol reveals the ACTIVE forme (Zamazenta-Crowned) while the
    // built set may carry the base name — the unique base match resolves
    // it. A team holding BOTH forme siblings as separate sets keeps the
    // exact match only (the sighting found 7-8-set VGC teams).
    const withBase = [mon('Zamazenta', 'Iron Head'), ...p1Team.slice(1)];
    const runtime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: withBase,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Eevee', 'Raichu', 'Zamazenta-Crowned', 'Jolteon'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });
    const names = runtime.battleStream.battle!.sides[0].pokemon.map(pokemon => pokemon.species.name);
    expect(names).toHaveLength(4);
    expect(names).toContain('Zamazenta');

    const withSiblings = [...p1Team.slice(0, 5), mon('Zamazenta', 'Iron Head'), mon('Zamazenta-Crowned', 'Behemoth Bash')];
    const siblingRuntime = await reconstructBranchRuntime({
      format: 'gen9doublesou',
      p1Team: withSiblings,
      p2Team,
      replayLog: vgcLog,
      targetTurn: 1,
      bringOnly: {
        p1: ['Pikachu', 'Eevee', 'Zamazenta-Crowned', 'Raichu'],
        p2: ['Squirtle', 'Ivysaur', 'Bulbasaur', 'Charmander'],
      },
    });
    const siblingNames = siblingRuntime.battleStream.battle!.sides[0].pokemon.map(pokemon => pokemon.species.name);
    expect(siblingNames).toHaveLength(4);
    expect(siblingNames).toContain('Zamazenta-Crowned');
    expect(siblingNames).not.toContain('Zamazenta');
  });

  test('the team-preview position honors the bring limit for the lead analysis', async () => {
    const { createRootPosition, legalChoices } = await import('../src/forward-model');
    const serialized = serializePreviewPosition('gen9doublesou', p1Team, p2Team, {
      p1: ['Pikachu', 'Eevee', 'Raichu', 'Jolteon'],
      p2: ['Bulbasaur', 'Charmander', 'Squirtle', 'Ivysaur'],
    });
    expect(serialized).not.toBeNull();
    const root = createRootPosition(serialized!);
    // Four brought per side: the lead enumeration prices real pairs only.
    const options = legalChoices(root, 'p1');
    expect(options).toHaveLength(6);
    expect(options.every(option => !option.label.includes('Flareon'))).toBe(true);
    // An unpinned side ([]) keeps its whole pool.
    const open = serializePreviewPosition('gen9doublesou', p1Team, p2Team, {
      p1: ['Pikachu', 'Eevee', 'Raichu', 'Jolteon'],
      p2: [],
    });
    expect(open).not.toBeNull();
    expect(legalChoices(createRootPosition(open!), 'p2')).toHaveLength(15);
  });
});
