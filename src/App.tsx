import { useState } from 'react';
import { inferReplayFormatId } from '@fulllifegames/replay-core';
import { LazyNewGameDialog } from './components/NewGameDialogLazy';
import { useGameTeamEdit } from './hooks/useGameTeamEdit';
import { ReplayLoader } from './components/ReplayLoader';
import { LandingGamesPanel } from './components/GameEntry';
import { TeamEditor } from './components/TeamEditor';
import { SetsImportExportPanel } from './components/SetsImportExportPanel';
import { SharedBranchView } from './components/SharedBranchView';
import { ReplayWorkspace } from './components/ReplayWorkspace';
import { BetaMark, SupportLinks } from './components/SupportLinks';
import { ReportIssueDialog } from './components/ReportIssueDialog';
import { buildSetsExport } from './lib/sets-io';
import { useAppController } from './hooks/useAppController';
import type { AppController } from './hooks/useAppController';

function EmbedLoadStatus({ app }: { app: AppController }) {
  const { loading, error, requestedReplay } = app.ctx.replay;
  return (
    <div className="ps-panel" style={{ marginTop: 8, fontSize: 12, color: '#aebdd0' }}>
      {error ? (
        <span role="alert" style={{ color: '#f3a6a6' }}>{error}</span>
      ) : loading || requestedReplay ? (
        'Loading replay…'
      ) : (
        'Waiting for a replay from the host page…'
      )}
    </div>
  );
}

/** Round 89 (#105, H4c): the address names a game this browser does not hold. */
function MissingGameNotice({ app }: { app: AppController }) {
  const id = app.ctx.address.missingGame;
  // it stands on the start page only: nothing is open, no shared branch owns the view, no host owns the page
  if (!id || app.ctx.replay.replayData || app.ctx.shared.sharedBranch || app.ctx.replay.embed) return null;
  return (
    <div className="ps-entry-notice" role="alert">
      The game {id} is not saved in this browser. A share link of the game (Game menu, Copy Share Link) brings it along.
    </div>
  );
}

/** Round 89 (#105, H5): a game's share link on its way, or the reason it did not open. */
function SharedGameNotice({ app }: { app: AppController }) {
  const { opening, error } = app.sharedGame;
  if (error) return <div className="ps-panel" role="alert" style={{ marginTop: 8, color: '#f3a6a6', fontSize: 11 }}>Unable to open the shared game: {error}</div>;
  return opening ? <div className="ps-entry-notice" role="status">Opening the shared game</div> : null;
}

function LoaderScreen({ app, onNewGame }: { app: AppController; onNewGame: () => void }) {
  const { loading, error, loadReplay, loadReplayFile, loadedReplayUrl } = app.ctx.replay;
  const { handleTeamLoad, teamPasteStatus, teamPasteError } = app.ctx.knowledge;
  return (
    <div style={{ marginTop: 8 }}>
      <ReplayLoader
        onLoad={loadReplay}
        onLoadFile={loadReplayFile}
        onTeamLoad={handleTeamLoad}
        loading={loading}
        error={error}
        loadedUrl={loadedReplayUrl}
        teamStatus={teamPasteStatus}
        teamError={teamPasteError}
        showGuide
      />
      <LandingGamesPanel onNewGame={onNewGame} onOpenGame={app.ctx.newGame.openRecord} currentGameId={app.ctx.newGame.record?.id ?? null} />
    </div>
  );
}

function AppModals({ app }: { app: AppController }) {
  const { replayData } = app.ctx.replay;
  const {
    setsPanelOpen, setSetsPanelOpen, applySetsText, statsP1Info, statsP2Info,
    editorSide, setEditorSide, saveTeam,
  } = app.ctx.knowledge;
  const { replayGen } = app.ctx.meta;
  // Round 89 (#105): the editor of a new game changes the game's record, not the replay's overlay.
  const { record, editTeams } = app.ctx.newGame;
  const gameEdit = useGameTeamEdit({ record, editTeams, stopBranch: app.board.discardVariation, close: () => setEditorSide(null) });
  const onSave = (side: 'p1' | 'p2', info: Parameters<typeof saveTeam>[1]) => { if (!gameEdit.edit(side, info)) saveTeam(side, info); };
  return (
    <>
      {gameEdit.notice && (
        <div className="ps-panel" role="alert" style={{ marginTop: 8, color: '#e6b36a', fontSize: 11 }}>
          {gameEdit.notice}<button type="button" className="ps-btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 10 }} onClick={gameEdit.dismiss}>Dismiss</button>
        </div>
      )}
      {setsPanelOpen && replayData && (
        <SetsImportExportPanel
          game={record !== null}
          // Round 70 (T205): the export reads what the stats panel shows (the solved spreads, the posted sheet), not the
          // enriched infos: those hold the usage guesses and the published IVs, and an import takes every value it reads
          // as the user's own input over the solver.
          exportText={buildSetsExport({
            p1Name: replayData.players[0] ?? 'p1',
            p2Name: replayData.players[1] ?? 'p2',
            p1Info: statsP1Info,
            p2Info: statsP2Info,
          })}
          onImport={text => {
            // a game's sets belong to its record: the import plays it again on them (editTeams), as the editor does
            const importError = applySetsText(text, record ? next => { gameEdit.editSides(next); } : undefined);
            if (!importError) setSetsPanelOpen(false);
            return importError;
          }}
          onClose={() => setSetsPanelOpen(false)}
        />
      )}
      {editorSide === 'p1' && statsP1Info && (
        <TeamEditor
          title="Edit Player Team"
          teamInfo={statsP1Info}
          gen={replayGen}
          format={replayData ? inferReplayFormatId(replayData) : ''}
          onSave={(info) => onSave('p1', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
      {editorSide === 'p2' && statsP2Info && (
        <TeamEditor
          title="Edit Opponent Team"
          teamInfo={statsP2Info}
          gen={replayGen}
          format={replayData ? inferReplayFormatId(replayData) : ''}
          onSave={(info) => onSave('p2', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
      {app.support.report && (
        <ReportIssueDialog report={app.support.report} game={app.ctx.newGame.record !== null} onDownload={() => void app.support.downloadState()} onClose={app.support.closeReport} />
      )}
    </>
  );
}

function App() {
  const app = useAppController();
  const { embed, replayData } = app.ctx.replay;
  const { sharedBranch, sharedBranchError, clearSharedBranch, handleLoadSharedOriginal } = app.ctx.shared;
  // Round 89 (#105): the New game dialog opens from the Game menu and from the start page's New game panel.
  const [newGameOpen, setNewGameOpen] = useState(false);
  const openNewGame = () => setNewGameOpen(true);

  return (
    <div className="ps-app-root">
      {/* Header (hidden when framed by a host site, and once a replay is
          loaded — on a 1080p screen every row above the pickers counts). */}
      {!embed && !replayData && (
        <div className="ps-app-header" style={{ borderRadius: '0 0 5px 5px' }}>
          <h1>PS Dashboard</h1>
          <BetaMark />
          <span style={{ fontSize: 10, color: '#aabbcc' }}>
            Load a replay or start a new game · branch off with different moves
          </span>
          <SupportLinks embed={false} onReportIssue={app.support.reportIssue} />
        </div>
      )}

      {sharedBranchError && !sharedBranch && (
        <div className="ps-panel" role="alert" style={{ marginTop: 8, color: '#f3a6a6', fontSize: 11 }}>
          Unable to open shared branch: {sharedBranchError}
        </div>
      )}

      {sharedBranch && (
        <SharedBranchView
          branch={sharedBranch}
          onLoadOriginal={handleLoadSharedOriginal}
          onClear={clearSharedBranch}
        />
      )}

      <MissingGameNotice app={app} />
      <SharedGameNotice app={app} />

      {!replayData && !sharedBranch && (embed ? (
        // The host page provides the replay — no loader chrome in embed mode.
        <EmbedLoadStatus app={app} />
      ) : (
        <LoaderScreen app={app} onNewGame={openNewGame} />
      ))}

      {replayData && !sharedBranch && <ReplayWorkspace app={app} replayData={replayData} onNewGame={embed ? undefined : openNewGame} />}

      <AppModals app={app} />
      {!embed && (
        <LazyNewGameDialog
          open={newGameOpen}
          onOpenChange={setNewGameOpen}
          onStart={app.ctx.newGame.startGame}
        />
      )}
    </div>
  );
}

export default App;
