import { ModalDialog } from './ModalDialog';
import type { IssueReport } from '../lib/support-state';

const STEP_STYLE = { fontSize: 12, color: '#cdd', margin: '0 0 8px' } as const;
const ACTION_STYLE = { display: 'inline-block', textDecoration: 'none', marginBottom: 14 } as const;

/**
 * Round 77 (user request 28.10.2026): "Report issue" opens this dialog instead of a tab and a download
 * of its own. The user downloads the state file and opens the filled issue form, each with one click.
 */
export function ReportIssueDialog({ report, onDownload, onClose }: {
  report: IssueReport;
  onDownload: () => void;
  onClose: () => void;
}) {
  return (
    <ModalDialog title="Report an issue" closeLabel="Close" onClose={onClose}>
      <p style={STEP_STYLE}>
        1. Download the state file <code>{report.fileName}</code>. It holds the replay, the sets the app played
        with, the variation and the position on screen, so the problem replays exactly.
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="ps-btn" style={ACTION_STYLE} onClick={onDownload}>Download state file</button>
        {report.downloaded && <span role="status" style={{ fontSize: 11, color: '#9c9' }}>Downloaded {report.fileName}</span>}
      </div>
      <p style={STEP_STYLE}>
        2. Open the issue form on GitHub, describe what happened, and drag the file into it.
      </p>
      <a className="ps-btn" style={ACTION_STYLE} href={report.issueUrl} target="_blank" rel="noopener noreferrer">
        Open the issue on GitHub
      </a>
      <p style={{ fontSize: 11, color: '#99a', margin: 0 }}>
        GitHub issues are public: the issue and the file show the replay and any team you pasted.
      </p>
    </ModalDialog>
  );
}
