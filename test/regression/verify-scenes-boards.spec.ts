import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BOARD_DIR, SCENE_BOARDS, boardFile, buildBoard, writeBoard } from './verify-scenes-boards.ts';

/**
 * Round 89 (B5a): the fixtures of the verify-scenes rows are the boards the app builds today, and this spec keeps them so.
 * Round 63 exported the three boards once and left them; the app builds its sets again on every analysis, so the rows
 * graded boards nobody saw (912045 t8's Ursaluna held a Life Orb that the log rules out). Each row rebuilds its board
 * through the app's path (`bankTeamsFor`, the saved replay and Smogon files of the feedback harness) and compares it
 * with the committed fixture. A change to the set build, the inference, the reconstruction or the simulator that moves
 * a board fails here first.
 *
 *   UPDATE_VERIFY_SCENES=1 npx vitest run --project app test/regression/verify-scenes-boards.spec.ts
 *
 * writes the fixtures again. Then run `tree-orchestrator.verify-scenes.spec.ts`, recompute the Monte-Carlo references of its rows (the
 * recipe is in EVALUATION.md, "Scene pins") and move the pins at the gate, as the rows' comments say.
 * Cost: three team builds and replay reconstructions, about 3 to 8 seconds each on devbox.
 */

const UPDATE = process.env.UPDATE_VERIFY_SCENES === '1';

/** The first path at which two JSON values differ, so a failure names a Pokemon's field rather than 45 kB of text. */
function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

describe('verify-scenes boards equal the app build (round 89, B5a)', () => {
  for (const scene of SCENE_BOARDS) {
    test(`${scene.id} t${scene.turn}`, { timeout: 120_000 }, async () => {
      const rebuilt = await buildBoard(scene);
      if (UPDATE) {
        mkdirSync(BOARD_DIR, { recursive: true });
        writeBoard(scene, rebuilt);
        return;
      }
      const file = boardFile(scene);
      expect(existsSync(file), `${fileURLToPath(file)} is missing: UPDATE_VERIFY_SCENES=1 writes it`).toBe(true);
      const fixture = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const { serialized: boardNow, ...restNow } = rebuilt;
      const { serialized: boardThen, ...restThen } = fixture;
      expect(restNow, 'the scene settings, played turn and sacks').toEqual(restThen);
      // The battle's log carries a wall-clock `|t:|` line per turn; nothing else in the board depends on the day.
      const board = (text: unknown) => JSON.parse((text as string).replace(/\|t:\|\d+/g, '|t:|0')) as unknown;
      const moved = firstDifference(board(boardThen), board(boardNow), 'board');
      expect(moved, 'the board the app builds now differs from the fixture; UPDATE_VERIFY_SCENES=1 rebuilds it').toBeNull();
    });
  }
});
