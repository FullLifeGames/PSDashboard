import { ConfirmBanner } from './ConfirmBanner';
import type { useGameTeamEdit } from '../hooks/useGameTeamEdit';

/** The question a team edit asks before it cuts played turns (H14a) and the notice after an edit that ended the line early or failed. */
export function GameEditNotices({ edit }: { edit: ReturnType<typeof useGameTeamEdit> }) {
  return (
    <>
      {edit.confirm && <ConfirmBanner message={edit.confirm.message} proceedLabel="Apply edit" onProceed={edit.confirm.proceed} onCancel={edit.confirm.cancel} />}
      {edit.notice && (
        <div className="ps-panel" role="alert" style={{ marginTop: 8, color: '#e6b36a', fontSize: 11 }}>
          {edit.notice}<button type="button" className="ps-btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 10 }} onClick={edit.dismiss}>Dismiss</button>
        </div>
      )}
    </>
  );
}
