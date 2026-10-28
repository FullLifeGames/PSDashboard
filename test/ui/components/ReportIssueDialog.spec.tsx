import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReportIssueDialog } from '../../../src/components/ReportIssueDialog';

const report = {
  fileName: 'ps-dashboard-state-gen9draft-2058494320-2026-10-28T15-39-31Z.json',
  issueUrl: 'https://github.com/FullLifeGames/PSDashboard/issues/new?template=bug_report.yml&title=x',
  downloaded: false,
};

describe('ReportIssueDialog (round 77, user request 28.10.2026)', () => {
  test('offers the state file as a download and the issue form as a link, and starts neither by itself', () => {
    const onDownload = vi.fn();
    const onClose = vi.fn();
    render(<ReportIssueDialog report={report} onDownload={onDownload} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Report an issue' })).toBeVisible();
    expect(screen.getByText(report.fileName, { exact: false })).toBeVisible();
    expect(onDownload).not.toHaveBeenCalled();

    const link = screen.getByRole('link', { name: 'Open the issue on GitHub' });
    expect(link).toHaveAttribute('href', report.issueUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));

    fireEvent.click(screen.getByRole('button', { name: 'Download state file' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('confirms the download and says that an issue is public', () => {
    render(<ReportIssueDialog report={{ ...report, downloaded: true }} onDownload={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(`Downloaded ${report.fileName}`);
    expect(screen.getByText(/GitHub issues are public/)).toBeVisible();
  });
});
