import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { Battle } from '@pkmn/client';
import { generationsFor, speciesBaseId } from '@fulllifegames/replay-core';
import { SharedBranchView } from '../../src/components/SharedBranchView';
import { useSharedBranch } from '../../src/hooks/useSharedBranch';
import { decodeBranchShare, encodeBranchShare, loadSavedBranches, savedBranchKey } from '../../src/lib/branch-share';
import { V1_SHARE_LINK, V1_SHARE_LINK_FACTS } from '../fixtures/v1-share-link';

/**
 * Round 72, T238 (gate decision 2): share links keep format version 1, and an old link plays the log it carries. The
 * fixture is a link the app built before the change: a played-out branch of 450650 whose `finalLog` the v1
 * `branchFrameLog` had already put into the replay's nicknames and flags. A link carries no sets for the engine to
 * rebuild, only that log and the choices shown beside it, so the new code (which builds the sets with the replay's
 * names and hands the frame the simulator's lines unchanged) meets the same reader as before.
 */

let blobs: Blob[] = [];

beforeEach(() => {
  blobs = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test/v1'; }),
    revokeObjectURL: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('a share link built on v1', () => {
  test('decodes at version 1 with the facts it was built with', () => {
    const payload = decodeBranchShare(V1_SHARE_LINK);
    expect(payload.version).toBe(1);
    expect(payload.replayId).toBe(V1_SHARE_LINK_FACTS.replayId);
    expect(payload.format).toBe(V1_SHARE_LINK_FACTS.format);
    expect(payload.branchTurn).toBe(V1_SHARE_LINK_FACTS.branchTurn);
    expect(payload.choices).toHaveLength(V1_SHARE_LINK_FACTS.choices);
    expect(payload.finalLog.split('\n')).toHaveLength(V1_SHARE_LINK_FACTS.lines);
    // The v1 frame spoke the replay's names: the log carries a nickname, not the species the set was named for.
    expect(payload.finalLog).toContain('|switch|p2a: EARFQUAKE?|Garchomp, F|');
    expect(encodeBranchShare(payload)).toBe(V1_SHARE_LINK);
  });

  test('useSharedBranch accepts the link like a new one', () => {
    window.location.hash = `#branch=${V1_SHARE_LINK}`;
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedBranchError).toBeNull();
    expect(result.current.sharedBranch?.replayId).toBe(V1_SHARE_LINK_FACTS.replayId);
    expect(result.current.sharedBranch?.finalLog).toBe(decodeBranchShare(V1_SHARE_LINK).finalLog);
    act(() => result.current.clearSharedBranch());
    expect(result.current.sharedBranch).toBeNull();
  });

  test('the view hands the iframe the carried log', async () => {
    const branch = decodeBranchShare(V1_SHARE_LINK);
    render(<SharedBranchView branch={branch} onLoadOriginal={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByTitle('Shared Branch Replay')).toHaveAttribute('src', 'blob:test/v1');
    expect(blobs).toHaveLength(1);
    const html = await blobs[0].text();
    // The only change the document makes is the escape a script tag needs for a closing tag inside the log.
    const embedded = branch.finalLog.replace(/<\//g, '<\\/');
    expect(html).toContain(`<script type="text/plain" class="battle-log-data">\n${embedded}\n</script>`);
    expect(screen.getByText(`Turn ${branch.choices[0].turnNumber}: P1 ${branch.choices[0].p1Choice} / P2 ${branch.choices[0].p2Choice}`)).toBeInTheDocument();
  });

  test('the roster the embed builds from the carried log has one entry per body, in the replay\'s names', () => {
    const branch = decodeBranchShare(V1_SHARE_LINK);
    const battle = new Battle(generationsFor(branch.format));
    for (const line of branch.finalLog.split('\n')) battle.add(line);
    for (const side of [battle.p1, battle.p2]) {
      const bases = side.team.map(body => speciesBaseId(body.speciesForme));
      expect(bases.length, side.team.map(body => body.ident).join(', ')).toBe(new Set(bases).size);
    }
    expect(battle.p2.team.map(body => body.ident)).toContain('p2a: EARFQUAKE?');
    expect(battle.p2.team.some(body => body.fainted)).toBe(true);
  });

  test('a saved branch of the same payload loads from local storage unchanged', () => {
    const payload = decodeBranchShare(V1_SHARE_LINK);
    localStorage.setItem(savedBranchKey(payload.replayId), JSON.stringify([payload]));
    expect(loadSavedBranches(payload.replayId)).toEqual([payload]);
  });
});
