import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BOARD_DIR, SCENE_BOARDS, boardFile, buildBoard, writeBoard } from './verify-scenes-boards.ts';

// After UPDATE_VERIFY_SCENES=1, recompute the verify-scenes Monte-Carlo references (EVALUATION.md "Scene pins").

const UPDATE = process.env.UPDATE_VERIFY_SCENES === '1';

function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

describe('verify-scenes boards equal the app build', () => {
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
