import { beforeAll, describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chainResults, loadSimMods, type ForcedDie } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { decodeBranchShare, encodeBranchShare, makeBranchSharePayload } from '../../../src/lib/branch-share';
import { sideMarkTexts, turnDiceMarks } from '../../../src/lib/branch-dice-marks';
import { freshLog, setOf } from '../fixtures/dice-battle';

/**
 * Round 89 (#114, F3; the user's ruling 31): a count of hits forced on a multi-accuracy move plays as the dock's click sets it
 * (the first hit, hits 2 to k, the miss of hit k + 1, as `chainResults` writes them), and the history row, the share link and the
 * frame's lines say it once: "Triple Axel: 2 hits". Singles and doubles, Scarlet/Violet and Champions.
 */
beforeAll(async () => {
  await loadSimMods('gen9championsou');
});

const mon = (species: string, moves: string[], extra = {}) => setOf(species, moves, { level: 50, ...extra });
const CAP = { evs: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 } };

const SCENES = [
  {
    kind: 'singles', format: 'gen9ou', move: 'tripleaxel', moveName: 'Triple Axel', hits: 3, count: 2,
    p1: [mon('Weavile', ['tripleaxel'])], p2: [mon('Blissey', ['splash'])], p1Moves: [{ targetLoc: undefined }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }],
  },
  {
    kind: 'doubles', format: 'gen9doublesou', move: 'populationbomb', moveName: 'Population Bomb', hits: 10, count: 4,
    p1: [mon('Blissey', ['splash']), mon('Maushold', ['populationbomb'])], p2: [mon('Blissey', ['splash']), mon('Chansey', ['splash'])],
    p1Moves: [{ moveId: 'splash', moveName: 'Splash' }, { targetLoc: 1 }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }, { moveId: 'splash', moveName: 'Splash' }],
  },
  {
    kind: 'Champions singles', format: 'gen9championsou', move: 'tripleaxel', moveName: 'Triple Axel', hits: 3, count: 2,
    p1: [mon('Weavile', ['tripleaxel'], CAP)], p2: [mon('Blissey', ['splash'], CAP)], p1Moves: [{ targetLoc: undefined }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }],
  },
  {
    kind: 'Champions doubles', format: 'gen9championsdoublescustomgame', move: 'populationbomb', moveName: 'Population Bomb', hits: 10, count: 4,
    p1: [mon('Blissey', ['splash'], CAP), mon('Maushold', ['populationbomb'], CAP)], p2: [mon('Blissey', ['splash'], CAP), mon('Chansey', ['splash'], CAP)],
    p1Moves: [{ moveId: 'splash', moveName: 'Splash' }, { targetLoc: 1 }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }, { moveId: 'splash', moveName: 'Splash' }],
  },
] as const;

describe.each(SCENES)('a count of hits forced on $moveName, $kind', scene => {
  test(`${scene.count} hits play ${scene.count} hits, and the history, the link and the frame say "${scene.count} hits" once`, async () => {
    const { result } = renderHook(() => useBranch());
    const p1 = [...scene.p1];
    const p2 = [...scene.p2];
    await act(async () => {
      await result.current.startBranch(scene.format, p1, p2, freshLog({ format: scene.format, p1, p2 }), 1, null, { playerNames: ['A', 'B'] });
    });
    expect(result.current.simState).not.toBeNull();
    const doubles = scene.kind.includes('doubles');
    const slot = doubles ? 1 : 0;
    const name = { slot: doubles ? 'p1b' : 'p1a', moveId: scene.move, targetSlot: 'p2a' } as const;
    const dice: ForcedDie[] = [
      { name: { ...name, kind: 'accuracy' }, result: { happens: true } },
      ...chainResults(scene.count, scene.hits).map(({ hit, happens }): ForcedDie => ({ name: { ...name, kind: 'accuracy', hit }, result: { happens } })),
    ];
    act(() => {
      scene.p1Moves.forEach((choice, index) => result.current.setChoice('p1', { kind: 'move', moveId: scene.move, moveName: scene.moveName, ...choice, ...(index === slot ? { dice } : {}) } as never, index));
      scene.p2Moves.forEach((choice, index) => result.current.setChoice('p2', { kind: 'move', ...choice } as never, index));
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.executeError).toBeNull();
    const current = result.current;
    expect(current.history).toHaveLength(1);

    expect(current.simState!.log.filter(line => line.startsWith('|-hitcount|p2a')).map(line => line.split('|')[3])).toEqual([String(scene.count)]);
    expect(sideMarkTexts(turnDiceMarks(current.history, 0), 'p1')).toEqual([`${scene.moveName}: ${scene.count} hits`]);

    const lines = branchFrameLog(current.simState!.log, current.history.flatMap(entry => entry.dieLines ?? [])).split('\n').filter(line => line.startsWith('|-message|Forced'));
    expect(lines.map(line => line.replace(/, [\d.]+ %$/, ''))).toEqual([`|-message|Forced: ${scene.moveName} hits`, `|-message|Forced: ${scene.moveName} ${scene.count} hits`]);

    const replay = { id: 'gen9test-1', format: scene.format, formatid: scene.format, players: ['A', 'B'], log: '', uploadtime: 0, views: 0 };
    const payload = decodeBranchShare(encodeBranchShare(makeBranchSharePayload({ replay, branchTurn: 1, history: current.history, finalLog: '' })));
    expect(payload.choices[0].p1DiceLabels).toEqual([`${scene.moveName}: ${scene.count} hits`]);
  }, 180_000);
});
