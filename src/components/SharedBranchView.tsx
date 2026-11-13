import { useLayoutHeight } from '../hooks/useLayoutHeight';
import { MatchTitle } from './MatchTitle';
import { PSReplayFrame } from './PSReplayFrame';
import type { BranchSharePayload } from '../lib/branch-share';
import { REPLAY_FRAME_HEIGHT } from '../lib/replay-html';
import { isGameId } from '../lib/new-game/record';

function SharedBranchTopbar({
  branch,
  onLoadOriginal,
  onClear,
}: {
  branch: BranchSharePayload;
  onLoadOriginal: (replayId: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="ps-topbar">
      <div className="ps-topbar-match" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <MatchTitle format={branch.format} players={branch.players} />
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
          Shared Branch
        </span>
        {/* a game of the app has no Showdown replay to load (round 89, #105, H5) */}
        {!isGameId(branch.replayId) && (
          <button
            type="button"
            className="ps-btn"
            onClick={() => onLoadOriginal(branch.replayId)}
            style={{ padding: '2px 8px', fontSize: 10 }}
          >
            Load Original Replay
          </button>
        )}
        <button
          type="button"
          className="ps-btn"
          onClick={onClear}
          style={{ padding: '2px 8px', fontSize: 10 }}
        >
          New Replay
        </button>
      </div>
    </div>
  );
}

type SharedChoice = BranchSharePayload['choices'][number];

/** One line of the choice list: names where the link carries them, the simulator commands for an older link. */
function choiceLine(choice: SharedChoice): string {
  const p1 = choice.p1Label ?? choice.p1Choice;
  const p2 = choice.p2Label ?? choice.p2Choice;
  if (choice.forcedSide) {
    return `Turn ${choice.turnNumber}, forced replacement (${choice.forcedSide.toUpperCase()}): ${choice.forcedSide === 'p1' ? p1 : p2}`;
  }
  return `Turn ${choice.turnNumber}: P1 ${p1} / P2 ${p2}`;
}

/** The dice the user forced in a turn, by side: the texts the history row shows. Nothing for a link from before the dice. */
function ChoiceDice({ choice }: { choice: SharedChoice }) {
  const dice = [
    ...(choice.p1DiceLabels ?? []).map(text => `P1 ${text}`),
    ...(choice.p2DiceLabels ?? []).map(text => `P2 ${text}`),
  ];
  if (dice.length === 0) return null;
  return (
    <div role="group" aria-label={`Forced dice, turn ${choice.turnNumber}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 10, color: '#aebdd0' }}>
      <span style={{ color: '#8899aa' }}>Forced dice</span>
      {dice.map((text, index) => <span key={index}>{text}</span>)}
    </div>
  );
}

function SharedBranchChoices({ branch }: { branch: BranchSharePayload }) {
  return (
    <div className="ps-panel ps-shared-branch-panel">
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Branch Choices</div>
      <div style={{ fontSize: 11, color: '#aebdd0', marginBottom: 8 }}>
        Branch started from turn {branch.branchTurn}. This read-only view replays the shared alternate line.
      </div>
      <div className="ps-shared-choice-list">
        {branch.choices.length > 0 ? branch.choices.map((choice, index) => (
          <div key={`${index}-${choice.turnNumber}`} className="ps-shared-choice-row">
            {choiceLine(choice)}
            <ChoiceDice choice={choice} />
          </div>
        )) : (
          <div className="ps-shared-choice-row">No executed branch choices were stored.</div>
        )}
      </div>
    </div>
  );
}

export function SharedBranchView({
  branch,
  onLoadOriginal,
  onClear,
}: {
  branch: BranchSharePayload;
  onLoadOriginal: (replayId: string) => void;
  onClear: () => void;
}) {
  const layoutRef = useLayoutHeight();
  return (
    <div className="ps-main-layout" ref={layoutRef}>
      <div className="ps-main-left">
        <SharedBranchTopbar branch={branch} onLoadOriginal={onLoadOriginal} onClear={onClear} />
        <div className="ps-iframe-wrap">
          <PSReplayFrame
            log={branch.finalLog}
            format={branch.format}
            p1={branch.players[0]}
            p2={branch.players[1]}
            title="Shared Branch Replay"
            height={REPLAY_FRAME_HEIGHT}
            seekTurn={branch.branchTurn}
            autoPlay={false}
            reloadKey={`shared:${branch.replayId}:${branch.createdAt}`}
          />
        </div>
        <SharedBranchChoices branch={branch} />
      </div>
      <div className="ps-main-right">
        <div className="ps-panel" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Replay Source</div>
          <div style={{ fontSize: 11, color: '#aebdd0', lineHeight: 1.5 }}>
            Replay id: <strong style={{ color: '#fff' }}>{branch.replayId}</strong>
            <br />
            Created: {new Date(branch.createdAt).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
