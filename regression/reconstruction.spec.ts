import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay } from '../src/lib/team-builder';
import { reconstructBranchRuntime, createBranchState } from '../src/lib/branch-engine';
import { parseReplayLog } from '../src/lib/protocol-parser';
import { parseExportedReplay } from '../src/lib/replay-file';
import { inferReplayFormatId } from '../src/lib/replay-format';

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadFixtureReplay() {
  return JSON.parse(readFileSync('e2e/fixtures/replay.json', 'utf-8')) as {
    formatid: string;
    log: string;
  };
}

// Saved from a real battle; gitignored (Gen9Draft-*), so tests using it skip when absent.
const SAVED_REPLAY_HTML = 'Gen9Draft-2026-01-06-2shy2shine-calleddxnnis.html';

function loadHtmlReplayLog(path: string): string {
  const html = readFileSync(path, 'utf-8');
  const match = html.match(/<script type="text\/plain" class="battle-log-data">\s*([\s\S]*?)\s*<\/script>/i);
  if (!match) {
    throw new Error(`Could not find battle log in ${path}`);
  }
  return match[1].replace(/\\\//g, '/').trim();
}

function snapshotMap(snapshotSide: {
  pokemon: {
    name: string;
    speciesForme: string;
    hpPercent: number;
    status: string;
    maxhp: number;
    fainted: boolean;
    isActive: boolean;
  }[];
}) {
  return new Map(
    snapshotSide.pokemon
      .filter(pokemon => pokemon.maxhp > 0 || pokemon.fainted || pokemon.isActive)
      .map(pokemon => [
        toId(pokemon.speciesForme),
        { hpPercent: pokemon.hpPercent, status: pokemon.status || '' },
      ]),
  );
}

function branchMap(side: { name: string; species: string; hpPercent: number; status: string }[]) {
  return new Map(
    side.map(pokemon => [
      toId(pokemon.species),
      { hpPercent: pokemon.hpPercent, status: pokemon.status || '' },
    ]),
  );
}

async function expectReplayCheckpointToReconstruct(params: {
  format: string;
  log: string;
  targetTurn: number;
}) {
  const { format, log, targetTurn } = params;
  const snapshots = parseReplayLog(log);
  const snapshot = snapshots.find(entry => entry.turn === targetTurn);
  expect(snapshot, `missing snapshot for turn ${targetTurn}`).toBeTruthy();

  const { p1Team, p2Team } = buildTeamsFromReplay(log);
  const logLines: string[] = [];

  const runtime = await reconstructBranchRuntime({
    format,
    p1Team,
    p2Team,
    replayLog: log,
    targetTurn,
    snapshot,
    onLogLines: lines => logLines.push(...lines),
  });

  const state = createBranchState(runtime.battleStream, logLines, {
    p1Choice: null,
    p2Choice: null,
  });

  expect(state.turnNumber).toBe(targetTurn);

  const expectedP1Active = snapshot!.p1.pokemon.find(pokemon => pokemon.isActive);
  const expectedP2Active = snapshot!.p2.pokemon.find(pokemon => pokemon.isActive);
  expect(state.p1Active?.species).toBe(expectedP1Active?.speciesForme);
  expect(state.p2Active?.species).toBe(expectedP2Active?.speciesForme);
  expect(state.p1Active?.hpPercent).toBe(expectedP1Active?.hpPercent);
  expect(state.p2Active?.hpPercent).toBe(expectedP2Active?.hpPercent);

  const expectedP1 = snapshotMap(snapshot!.p1);
  const expectedP2 = snapshotMap(snapshot!.p2);
  const actualP1 = branchMap(state.p1Pokemon);
  const actualP2 = branchMap(state.p2Pokemon);

  for (const [key, value] of expectedP1) {
    expect(actualP1.get(key)?.hpPercent).toBe(value.hpPercent);
    expect(actualP1.get(key)?.status || '').toBe(value.status);
  }
  for (const [key, value] of expectedP2) {
    expect(actualP2.get(key)?.hpPercent).toBe(value.hpPercent);
    expect(actualP2.get(key)?.status || '').toBe(value.status);
  }
}

async function waitForBranchLog(
  runtime: Awaited<ReturnType<typeof reconstructBranchRuntime>>,
  predicate: (log: string[]) => boolean,
) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate(runtime.log)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for branch log. Tail:\n${runtime.log.slice(-20).join('\n')}`);
}

test.describe('Replay reconstruction regression suite', () => {
  test('reconstructs a stable checkpoint from the fixture replay', async () => {
    const fixture = loadFixtureReplay();
    await expectReplayCheckpointToReconstruct({
      format: fixture.formatid || 'gen9ou',
      log: fixture.log,
      targetTurn: 1,
    });
  });

  test('single-pass capture yields a position at every turn boundary', async () => {
    const fixture = loadFixtureReplay();
    const snapshots = parseReplayLog(fixture.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(fixture.log);
    const targetTurn = 3;
    const captured = new Map<number, string>();

    const runtime = await reconstructBranchRuntime({
      format: fixture.formatid || 'gen9ou',
      p1Team,
      p2Team,
      replayLog: fixture.log,
      targetTurn,
      snapshot: snapshots[Math.min(targetTurn - 1, snapshots.length - 1)] ?? null,
      capturePositions: {
        snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
        onPosition: (turn, battle) => {
          captured.set(turn, JSON.stringify({ turn: battle.turn, ended: battle.ended }));
        },
      },
    });

    // One pass produced every boundary before the target…
    expect([...captured.keys()]).toEqual([1, 2]);
    for (const [turn, state] of captured) {
      expect(JSON.parse(state).turn).toBe(turn);
      expect(JSON.parse(state).ended).toBe(false);
    }
    // …and the runtime itself is the final position, same as a per-turn run
    // (whose state fidelity the checkpoint test above already covers).
    expect(runtime.battleStream.battle?.turn).toBe(targetTurn);
  });

  test('reconstructs stable checkpoints from a real saved replay', async () => {
    test.skip(!existsSync(SAVED_REPLAY_HTML), 'local saved replay HTML is gitignored and not present');
    const log = loadHtmlReplayLog(SAVED_REPLAY_HTML);
    for (const targetTurn of [3, 5]) {
      await expectReplayCheckpointToReconstruct({
        format: 'gen9draft',
        log,
        targetTurn,
      });
    }
  });

  test.fixme('documents a known divergence after the first fixture turn', async () => {
    const fixture = loadFixtureReplay();
    await expectReplayCheckpointToReconstruct({
      format: fixture.formatid || 'gen9ou',
      log: fixture.log,
      targetTurn: 2,
    });
  });

  test.fixme('documents a known deeper-turn divergence in the saved replay', async () => {
    test.skip(!existsSync(SAVED_REPLAY_HTML), 'local saved replay HTML is gitignored and not present');
    const log = loadHtmlReplayLog(SAVED_REPLAY_HTML);
    await expectReplayCheckpointToReconstruct({
      format: 'gen9draft',
      log,
      targetTurn: 10,
    });
  });

  test('keeps battle-only forme switches merged into the revealed base species', () => {
    const log = [
      '|gametype|singles',
      '|player|p1|Player 1||',
      '|player|p2|Player 2||',
      '|poke|p1|Terapagos, M|',
      '|poke|p1|Gliscor, F|',
      '|poke|p2|Ting-Lu|',
      '|switch|p1a: Lolopagos|Terapagos, M|100/100',
      '|detailschange|p1a: Lolopagos|Terapagos-Terastal, M',
      '|switch|p2a: Ting-Lu|Ting-Lu|100/100',
      '|turn|1',
      '|switch|p1a: Glolo|Gliscor, F|100/100',
      '|move|p2a: Ting-Lu|Spikes|p1a: Glolo',
      '|upkeep',
      '|turn|2',
      '|switch|p1a: Lolopagos|Terapagos-Terastal, M|100/100',
      '|move|p1a: Lolopagos|Rapid Spin|p2a: Ting-Lu',
      '|move|p2a: Ting-Lu|Ruination|p1a: Lolopagos',
    ].join('\n');

    const { p1Team } = buildTeamsFromReplay(log);
    const terapagos = p1Team.filter(pokemon => pokemon.species === 'Terapagos');

    expect(terapagos).toHaveLength(1);
    expect(p1Team.some(pokemon => pokemon.species === 'Terapagos-Terastal')).toBe(false);
    expect(terapagos[0].moves).toContain('Rapid Spin');
  });

  test('uses embedded showteam exports from replay chat before guessed sets', () => {
    const log = [
      '|player|p1|Bene||',
      '|player|p2|Lolome||',
      '|poke|p1|Terapagos, M|',
      '|poke|p2|Scizor, M|',
      '|switch|p1a: Lolopagos|Terapagos, M|100/100',
      '|switch|p2a: Scizor|Scizor, M|100/100',
      '|move|p1a: Lolopagos|Rapid Spin|p2a: Scizor',
      '|move|p2a: Scizor|U-turn|p1a: Lolopagos',
      '|c| Bene|/raw <div class="infobox"><details><summary>View team</summary>Lolopagos (Terapagos) (M) @ Heavy-Duty Boots  <br />Ability: Tera Shift  <br />Tera Type: Stellar  <br />EVs: 252 SpA &#x2f; 4 SpD &#x2f; 252 Spe  <br />Modest Nature  <br />- Rapid Spin  <br />- Flamethrower  <br />- Earth Power  <br />- Ice Beam  <br /></details></div>',
      '|c| Lolome|/raw <div class="infobox"><details><summary>View team</summary>Scizor (M) @ Choice Band  <br />Ability: Technician  <br />Tera Type: Bug  <br />EVs: 192 HP &#x2f; 252 Atk &#x2f; 64 Spe  <br />Adamant Nature  <br />- Bullet Punch  <br />- U-turn  <br />- Knock Off  <br />- Bug Bite  <br /></details></div>',
    ].join('\n');

    const { p1Team, p2Team } = buildTeamsFromReplay(log);

    expect(p1Team[0]).toMatchObject({
      species: 'Terapagos',
      item: 'Heavy-Duty Boots',
      ability: 'Tera Shift',
      teraType: 'Stellar',
      moves: ['Rapid Spin', 'Flamethrower', 'Earth Power', 'Ice Beam'],
    });
    expect(p2Team[0]).toMatchObject({
      species: 'Scizor',
      item: 'Choice Band',
      ability: 'Technician',
      moves: ['Bullet Punch', 'U-turn', 'Knock Off', 'Bug Bite'],
    });
  });

  test('replays reconstructed move choices by slot instead of invalid move ids', async () => {
    const log = [
      '|gametype|singles',
      '|player|p1|Bene||',
      '|player|p2|Lolome||',
      '|gen|9',
      '|tier|[Gen 9] Draft',
      '|poke|p1|Kleavor, M|',
      '|poke|p2|Scizor, M|',
      '|poke|p2|Amoonguss, F|',
      '|c| Bene|/raw <div class="infobox"><details><summary>View team</summary>Klolovor (Kleavor) (M) @ Heavy-Duty Boots  <br />Ability: Sharpness  <br />Tera Type: Bug  <br />EVs: 160 HP &#x2f; 252 Atk &#x2f; 96 Spe  <br />Adamant Nature  <br />- Stone Axe  <br />- X-Scissor  <br />- Aerial Ace  <br />- Night Slash  <br /></details></div>',
      '|c| Lolome|/raw <div class="infobox"><details><summary>View team</summary>Scizor (M) @ Choice Band  <br />Ability: Technician  <br />Tera Type: Bug  <br />EVs: 192 HP &#x2f; 252 Atk &#x2f; 64 Spe  <br />Adamant Nature  <br />- Bullet Punch  <br />- U-turn  <br />- Knock Off  <br />- Bug Bite  <br /><br />Amoonguss (F) @ Rocky Helmet  <br />Ability: Regenerator  <br />Tera Type: Grass  <br />EVs: 248 HP &#x2f; 252 Def &#x2f; 8 SpD  <br />Relaxed Nature  <br />- Sludge Bomb  <br />- Stomping Tantrum  <br />- Clear Smog  <br />- Synthesis  <br /></details></div>',
      '|start',
      '|switch|p1a: Klolovor|Kleavor, M|100/100',
      '|switch|p2a: Scizor|Scizor, M|100/100',
      '|turn|1',
      '|move|p1a: Klolovor|Stone Axe|p2a: Scizor',
      '|-damage|p2a: Scizor|40/100',
      '|move|p2a: Scizor|U-turn|p1a: Klolovor',
      '|-damage|p1a: Klolovor|31/100',
      '|switch|p2a: Amoonguss|Amoonguss, F|100/100|[from] U-turn',
      '|upkeep',
      '|turn|2',
    ].join('\n');
    const { p1Team, p2Team } = buildTeamsFromReplay(log);

    const runtime = await reconstructBranchRuntime({
      format: 'gen9draft',
      p1Team,
      p2Team,
      replayLog: log,
      targetTurn: 2,
    });
    await waitForBranchLog(runtime, branchLog => branchLog.some(line => line.startsWith('|move|')));

    expect(runtime.log.join('\n')).toContain('|move|p1a: Klolovor|Stone Axe|p2a: Scizor');
    expect(runtime.log.join('\n')).toContain('|move|p2a: Scizor|U-turn|p1a: Klolovor');
    expect(runtime.log.join('\n')).not.toContain('|move|p2a: Scizor|Bullet Punch|p1a: Klolovor');
  });

  test('replays a Mega Evolution so later positions cannot re-offer it', async () => {
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
      '|poke|p2|Snorlax, M|',
      '|start',
      '|switch|p1a: Scizor|Scizor, M|100/100',
      '|switch|p2a: Snorlax|Snorlax, M|100/100',
      '|turn|1',
      '|detailschange|p1a: Scizor|Scizor-Mega, M',
      '|-mega|p1a: Scizor|Scizor|Scizorite',
      '|move|p1a: Scizor|Bullet Punch|p2a: Snorlax',
      '|-damage|p2a: Snorlax|85/100',
      '|move|p2a: Snorlax|Tackle|p1a: Scizor',
      '|-damage|p1a: Scizor|90/100',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen7ou',
      p1Team: [{ ...set('Scizor', ['Bullet Punch'], 'Scizorite'), ability: 'Technician' }],
      p2Team: [{ ...set('Snorlax', ['Tackle']), ability: 'Immunity' }],
      replayLog: log,
      targetTurn: 2,
    });
    const scizor = runtime.battleStream.battle!.sides[0].active[0]!;
    expect(scizor.species.name).toBe('Scizor-Mega');
    expect(scizor.canMegaEvo).toBeFalsy();
  });

  test('replays a Terastallization so later positions cannot re-offer it', async () => {
    const set = (species: string, ability: string, moves: string[]): PokemonSet => ({
      name: species, species, item: '', ability, moves,
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
      teraType: 'Water',
    });
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] OU',
      '|poke|p1|Snorlax, M|',
      '|poke|p2|Chansey, F|',
      '|start',
      '|switch|p1a: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|-terastallize|p1a: Snorlax|Water',
      '|move|p1a: Snorlax|Tackle|p2a: Chansey',
      '|-damage|p2a: Chansey|90/100',
      '|move|p2a: Chansey|Seismic Toss|p1a: Snorlax',
      '|-damage|p1a: Snorlax|80/100',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team: [set('Snorlax', 'Immunity', ['Tackle'])],
      p2Team: [set('Chansey', 'Natural Cure', ['Seismic Toss'])],
      replayLog: log,
      targetTurn: 2,
    });
    const snorlax = runtime.battleStream.battle!.sides[0].active[0]!;
    expect(snorlax.terastallized).toBe('Water');
    expect(snorlax.canTerastallize).toBeFalsy();
  });

  test('corrects active Pokémon from protocol switch effects the simulator cannot reproduce', async () => {
    const p1Team: PokemonSet[] = [
      {
        name: 'Decidueye',
        species: 'Decidueye',
        item: '',
        ability: 'Overgrow',
        moves: ['Leaf Blade', 'Protect'],
        nature: 'Adamant',
        evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        level: 100,
      },
      {
        name: 'Gliscor',
        species: 'Gliscor',
        item: 'Toxic Orb',
        ability: 'Poison Heal',
        moves: ['Toxic', 'Protect'],
        nature: 'Impish',
        evs: { hp: 244, atk: 0, def: 252, spa: 0, spd: 12, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        level: 100,
      },
    ];
    const p2Team: PokemonSet[] = [{
      name: 'Rotom',
      species: 'Rotom',
      item: '',
      ability: 'Levitate',
      moves: ['Thunderbolt', 'Protect'],
      nature: 'Timid',
      evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 100,
    }];
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] OU',
      '|clearpoke',
      '|poke|p1|Decidueye, M|',
      '|poke|p1|Gliscor, M|',
      '|poke|p2|Rotom|',
      '|start',
      '|switch|p1a: Decidueye|Decidueye, M|100/100',
      '|switch|p2a: Rotom|Rotom|100/100',
      '|turn|1',
      '|move|p1a: Decidueye|Leaf Blade|p2a: Rotom',
      '|-damage|p2a: Rotom|80/100',
      '|move|p2a: Rotom|Thunderbolt|p1a: Decidueye',
      '|-damage|p1a: Decidueye|70/100',
      '|switch|p1a: Gliscor|Gliscor, M|100/100|[from] item: Eject Button',
      '|upkeep',
      '|turn|2',
      '|move|p1a: Gliscor|Toxic|p2a: Rotom',
      '|-status|p2a: Rotom|tox',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9ou',
      p1Team,
      p2Team,
      replayLog: log,
      targetTurn: 2,
    });
    const state = createBranchState(runtime.battleStream, runtime.log, {
      p1Choice: null,
      p2Choice: null,
    });

    expect(state.p1Active?.species).toBe('Gliscor');
    expect(state.p1Moves.map(move => move.name)).toContain('Toxic');
    expect(runtime.log.join('\n')).toMatch(/\|switch\|p1a: Gliscor\|Gliscor(?:, [MF])?\|/);
  });

  test('branch runtime exposes one live append-only protocol log after alternate choices', async () => {
    const fixture = loadFixtureReplay();
    const snapshots = parseReplayLog(fixture.log);
    const snapshot = snapshots.find(entry => entry.turn === 1);
    const { p1Team, p2Team } = buildTeamsFromReplay(fixture.log);

    const runtime = await reconstructBranchRuntime({
      format: fixture.formatid || 'gen9ou',
      p1Team,
      p2Team,
      replayLog: fixture.log,
      targetTurn: 1,
      snapshot,
    });

    const initialLength = runtime.log.length;
    const initialStartCount = runtime.log.filter(line => line === '|start').length;

    void runtime.streams.omniscient.write('>p1 move 1\n>p2 move 1');

    await waitForBranchLog(runtime, log =>
      log.length > initialLength && log.some(line => line.startsWith('|move|p1a: Garchomp|'))
    );

    expect(runtime.log.filter(line => line === '|start')).toHaveLength(initialStartCount);
    expect(runtime.log.join('\n')).toContain('|move|p1a: Garchomp|Earthquake|p2a: Kingambit');
  });

  test('replays a taunt-blocked move from its |cant| line instead of defaulting to move 1', async () => {
    const set = (species: string, ability: string, moves: string[]): PokemonSet => ({
      name: species, species, item: '', ability, moves,
      nature: 'Timid',
      evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: 50,
    });
    // Uxie's move 1 is U-turn: falling back to `move 1` for the blocked turn
    // plays a pivot move the real game never saw and pulls the next Pokémon
    // in a turn early — the first domino of the GPL replay-loop desync.
    const log = [
      '|gametype|singles',
      '|player|p1|Alice||',
      '|player|p2|Bob||',
      '|gen|9',
      '|tier|[Gen 9] Custom Game',
      '|clearpoke',
      '|poke|p1|Uxie, L50|',
      '|poke|p1|Noivern, L50|',
      '|poke|p2|Iron Jugulis, L50|',
      '|start',
      '|switch|p1a: Uxie|Uxie, L50|182/182',
      '|switch|p2a: Jugulis|Iron Jugulis, L50|201/201',
      '|turn|1',
      '|move|p2a: Jugulis|Taunt|p1a: Uxie',
      '|-start|p1a: Uxie|move: Taunt',
      '|cant|p1a: Uxie|move: Taunt|Stealth Rock',
      '|upkeep',
      '|turn|2',
    ].join('\n');

    const runtime = await reconstructBranchRuntime({
      format: 'gen9customgame',
      p1Team: [set('Uxie', 'Levitate', ['U-turn', 'Stealth Rock', 'Psychic']), set('Noivern', 'Frisk', ['Air Slash'])],
      p2Team: [set('Iron Jugulis', 'Quark Drive', ['Taunt', 'Flash Cannon'])],
      replayLog: log,
      targetTurn: 2,
    });

    expect(runtime.battleStream.battle?.sides[0].active[0]?.species.name).toBe('Uxie');
    expect(runtime.log.join('\n')).not.toContain('|move|p1a: Uxie|U-turn|');
  });
});

test.describe('Turn-synchronized replay of a video-reconstructed log', () => {
  // Synthetic GPL log (gpl-pipeline video reconstruction): no |upkeep| markers,
  // Sleep Talk/Rest loops, and a taunt-blocked turn 1. Before the turn-sync
  // guard the block replayer ran ~5 turns ahead of the simulator here, so
  // pending state like Future Sight silently vanished from every branch.
  function loadGplReplay() {
    return parseExportedReplay(readFileSync('e2e/fixtures/gpl-replay.html', 'utf-8'), 'gpl-replay.html');
  }

  test('reveals Life Orb and Rocky Helmet from item-damage lines in the log', () => {
    const replay = loadGplReplay();
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);

    // Iron Valiant's Life Orb recoil and Uxie's Rocky Helmet chip (no [of]
    // attribution in this log) both surface as revealed items.
    expect(p2Team.find(set => set.species === 'Iron Valiant')?.item).toBe('Life Orb');
    expect(p1Team.find(set => set.species === 'Uxie')?.item).toBe('Rocky Helmet');
    expect(p2Team.find(set => set.species === 'Rotom-Wash')?.item).toBe('Black Sludge');
  });

  test('keeps the simulator in lockstep through the taunted turn 1', async () => {
    const replay = loadGplReplay();
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);

    const runtime = await reconstructBranchRuntime({
      format: inferReplayFormatId(replay),
      p1Team,
      p2Team,
      replayLog: replay.log,
      targetTurn: 2,
    });

    // Turn 1: Uxie was taunted and never moved — it must still be in.
    expect(runtime.battleStream.battle?.turn).toBe(2);
    expect(runtime.battleStream.battle?.sides[0].active[0]?.species.name).toBe('Uxie');
  });

  test('carries the pending Future Sight to the branch point at turn 25', async () => {
    test.setTimeout(120_000);
    const replay = loadGplReplay();
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log);
    const snapshots = parseReplayLog(replay.log);

    // Mirrors the eval sweep's call: per-turn snapshot corrections keep the
    // sim's damage rolls from drifting away from the recorded HP.
    const runtime = await reconstructBranchRuntime({
      format: inferReplayFormatId(replay),
      p1Team,
      p2Team,
      replayLog: replay.log,
      targetTurn: 25,
      snapshot: snapshots[Math.min(24, snapshots.length - 1)] ?? null,
      capturePositions: {
        snapshotFor: turn => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null,
        onPosition: () => {},
      },
    });

    const battle = runtime.battleStream.battle!;
    expect(battle.turn).toBe(25);
    // Turn 24 cast Future Sight at p2's slot; it lands on turn 26, so the
    // pending slot condition must survive to the turn-25 branch point.
    expect(Object.keys(battle.sides[1].slotConditions[0] ?? {})).toContain('futuremove');
    expect(battle.sides[0].active[0]?.species.name).toBe('Uxie');
    expect(battle.sides[1].active[0]?.species.name).toBe('Rhydon');
  });
});
