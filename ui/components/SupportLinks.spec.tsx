import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BetaMark, SupportLinks } from '../../src/components/SupportLinks';

describe('the support links (round 77, user gate 28.10.2026: 1a with "by Bene (FullLifeGames)", mobile a)', () => {
  test('Report issue calls its handler; the creator link opens fulllifegames.com in a new tab', async () => {
    const onReportIssue = vi.fn();
    render(<SupportLinks embed={false} onReportIssue={onReportIssue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Report issue' }));
    expect(onReportIssue).toHaveBeenCalledTimes(1);
    const creator = screen.getByRole('link', { name: 'by Bene (FullLifeGames)' });
    expect(creator).toHaveAttribute('href', 'https://fulllifegames.com');
    expect(creator).toHaveAttribute('target', '_blank');
    expect(creator).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('PS Dashboard')).toBeNull();
  });

  test('in a host site\'s frame the creator link is left out; with a loaded replay the name and Beta ride along', () => {
    const { rerender } = render(<SupportLinks embed onReportIssue={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'by Bene (FullLifeGames)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Report issue' })).toBeInTheDocument();

    rerender(<SupportLinks embed={false} withName onReportIssue={vi.fn()} />);
    expect(screen.getByText('PS Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // Never a heading: the page keeps one h1 before load and none in embed mode.
    expect(document.querySelector('h1')).toBeNull();
  });

  test('the Beta mark names what it means', () => {
    render(<BetaMark />);
    expect(screen.getByText('Beta')).toHaveAttribute('title', expect.stringContaining('Report issue'));
  });
});
