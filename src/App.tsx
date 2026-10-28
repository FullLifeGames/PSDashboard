import { inferReplayFormatId } from '@fulllifegames/replay-core';
import { ReplayLoader } from './components/ReplayLoader';
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

function LoaderScreen({ app }: { app: AppController }) {
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
  return (
    <>
      {setsPanelOpen && replayData && (
        <SetsImportExportPanel
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
            const importError = applySetsText(text);
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
          onSave={(info) => saveTeam('p1', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
      {editorSide === 'p2' && statsP2Info && (
        <TeamEditor
          title="Edit Opponent Team"
          teamInfo={statsP2Info}
          gen={replayGen}
          format={replayData ? inferReplayFormatId(replayData) : ''}
          onSave={(info) => saveTeam('p2', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
      {app.support.report && (
        <ReportIssueDialog report={app.support.report} onDownload={() => void app.support.downloadState()} onClose={app.support.closeReport} />
      )}
    </>
  );
}

function App() {
  const app = useAppController();
  const { embed, replayData } = app.ctx.replay;
  const { sharedBranch, sharedBranchError, clearSharedBranch, handleLoadSharedOriginal } = app.ctx.shared;

  return (
    <div className="ps-app-root">
      {/* Header (hidden when framed by a host site, and once a replay is
          loaded — on a 1080p screen every row above the pickers counts). */}
      {!embed && !replayData && (
        <div className="ps-app-header" style={{ borderRadius: '0 0 5px 5px' }}>
          <h1>PS Dashboard</h1>
          <BetaMark />
          <span style={{ fontSize: 10, color: '#aabbcc' }}>
            Load a replay · branch off with different moves
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

      {!replayData && !sharedBranch && (embed ? (
        // The host page provides the replay — no loader chrome in embed mode.
        <EmbedLoadStatus app={app} />
      ) : (
        <LoaderScreen app={app} />
      ))}

      {replayData && !sharedBranch && <ReplayWorkspace app={app} replayData={replayData} />}

      <AppModals app={app} />
    </div>
  );
}

export default App;
