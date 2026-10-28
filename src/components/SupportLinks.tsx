import { CREATOR_URL } from '../lib/support-state';

/** The "Beta" mark beside the app's name. */
export function BetaMark() {
  return (
    <span className="ps-beta-mark" title="PS Dashboard is in beta: if something looks wrong, Report issue sends it with the app's state.">
      Beta
    </span>
  );
}

/**
 * Round 77 (user gate 28.10.2026, 1a, mobile a): Report issue and the creator link, beside the app's name
 * before a replay loads and at the end of the top bar with one loaded (`withName` adds the name and the Beta
 * mark there). A host site's frame (embed mode) carries its own imprint, so the creator link is left out.
 * Below 640 px the top bar stacks and these links form their own row.
 */
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
