import { CREATOR_URL } from '../lib/support-state';

export function BetaMark() {
  return (
    <span className="ps-beta-mark" title="PS Dashboard is in beta: if something looks wrong, Report issue sends it with the app's state.">
      Beta
    </span>
  );
}

/** In embed mode the host site's frame carries its own imprint, so the creator link is left out. */
export function SupportLinks({ embed, withName = false, onReportIssue }: {
  embed: boolean;
  withName?: boolean;
  onReportIssue: () => void;
}) {
  return (
    <span className="ps-support-links">
      {withName && (
        <span className="ps-support-name">
          PS Dashboard <BetaMark />
        </span>
      )}
      <button type="button" className="ps-support-link" onClick={onReportIssue}>
        Report issue
      </button>
      {!embed && (
        <a className="ps-support-link" href={CREATOR_URL} target="_blank" rel="noopener noreferrer">
          by Bene (FullLifeGames)
        </a>
      )}
    </span>
  );
}
