import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winDeltaText, winPctText } from '@fulllifegames/eval-engine';
import { SideRow } from '../../../../src/components/eval/SideRow';
import { rankedChoice } from '../../fixtures/eval-result';
import { misplayedSide, sideAnalysis } from '../../fixtures/analysis';

describe('SideRow', () => {
  test('a side on the engine\'s line: the played move with its win chance and floor, the agreement tick, no comparison', async () => {
    const onExplore = vi.fn();
    const side = sideAnalysis();
    render(<SideRow name="Alice" side={side} onExplore={onExplore} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/^played /)).toHaveTextContent(`played Earthquake (${winPctText(0.35)})`);
    expect(screen.getByText(/· risked/)).toHaveTextContent(`· risked ${winPctText(0.15)}`);
    await userEvent.click(screen.getByRole('button', { name: '✓ the engine\'s move ↗' }));
    expect(onExplore).toHaveBeenCalledWith(side.best);
    expect(screen.queryByText('difference:')).toBeNull();
  });

  test('a mistake: the regret chip, the played line against the engine line, and their difference', async () => {
    const onExplore = vi.fn();
    const side = misplayedSide();
    const { rerender } = render(<SideRow name="Alice" side={side} onExplore={onExplore} />);
    expect(screen.getByText(`mistake · ${winDeltaText(-0.25)}`)).toHaveAttribute('title', 'Alice gave up this much win probability vs the engine\'s best.');
    expect(screen.queryByText(/engine:/)).toBeNull();
    expect(screen.getByText(`${winPctText(0.1)} played`)).toBeInTheDocument();
    expect(screen.getByText('· worst vs Leech Seed')).toBeInTheDocument();
    expect(screen.getByText(`${winPctText(0.35)} better:`)).toBeInTheDocument();
    expect(screen.getByText('· worst vs Protect')).toBeInTheDocument();
    // Two different moves differ wholesale: the labels tell the story, no condensed difference.
    expect(screen.queryByText('difference:')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Earthquake ↗' }));
    expect(onExplore).toHaveBeenCalledWith(side.best);

    const teraBest = rankedChoice('move earthquake terastallize', 'Tera + Earthquake', 0.35);
    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { best: teraBest, played: rankedChoice('move earthquake', 'Earthquake', 0.1) })} />);
    expect(screen.getByText('difference:').nextElementSibling).toHaveTextContent(/^only the/);
  });

  test('the better line through a forced switch shows the switch alone, never the waiting placeholder', () => {
    const best = rankedChoice('switch 2', '→ Tyranitar', 0.35, {
      punishedBy: 'Ice Punch', line: [{ p1: '→ Keldeo', p2: '(waiting)' }, { p1: 'Hydro Pump', p2: 'High Jump Kick' }],
    });
    render(<SideRow name="Alice" side={misplayedSide('mistake', { best, safe: best })} />);
    expect(screen.getByText('then → Keldeo → Hydro Pump · High Jump Kick')).toBeInTheDocument();
    expect(screen.queryByText(/\(waiting\)/)).toBeNull();
  });

  test('the sack note says which sack it was: a switch-in the hazards took, or a body left in to take the priced hit', () => {
    const { rerender } = render(<SideRow name="Alice" side={sideAnalysis({ sacrifice: { name: 'Weavile', hpFraction: 0.22, healthy: true, hazard: true, verified: true } })} />);
    expect(screen.getByText('· sacked Weavile (22% HP)')).toHaveAttribute('title', expect.stringContaining('entry hazards'));
    rerender(<SideRow name="Alice" side={sideAnalysis({ sacrifice: { name: 'Weavile', hpFraction: 0.6, stayed: true, verified: true } })} />);
    expect(screen.getByText('· sacked Weavile (60% HP)')).toHaveAttribute('title', expect.stringContaining('left in'));
  });

  test('a stayed sack the window did not verify claims no payback (T123 point 4, the 573756 t68 shape without verified)', () => {
    // A tiered stayed feed clears the payoff margin but not regret plus margin: demoted, not verified (grading.ts sackVerdict).
    const { rerender } = render(<SideRow name="Alice" side={misplayedSide('mistake', { tier: 'inaccuracy', sacrifice: { name: 'Weavile', hpFraction: 0.77, stayed: true } })} />);
    const note = screen.getByText('· sacked Weavile (77% HP)');
    expect(note).toHaveAttribute('title', expect.stringContaining('payoff window'));
    expect(note.getAttribute('title')).not.toContain('paid it back');
    rerender(<SideRow name="Alice" side={sideAnalysis({ sacrifice: { name: 'Weavile', hpFraction: 0.77, stayed: true, verified: true } })} />);
    expect(screen.getByText('· sacked Weavile (77% HP)')).toHaveAttribute('title', expect.stringContaining('paid it back'));
  });

  test('a regret over 1 shows the two win chances it spans, the real regret in the title (T123 point 8, 2630685175 t8 shape)', () => {
    const played = rankedChoice('move taunt 1, move bodypress 2', 'Taunt→Calyrex-Ice + Body Press→Terapagos-Stellar', -0.767);
    const best = rankedChoice('move astralbarrage, move bodypress 1', 'Astral Barrage + Body Press→Calyrex-Ice', 0.92);
    const { rerender } = render(<SideRow name="Alice" side={misplayedSide('mistake', { played, best, safe: best, regret: 1.687 })} />);
    const chipText = `mistake · ${winPctText(0.92)} to ${winPctText(-0.767)}`;
    expect(chipText).toBe('mistake · 85% to 19%');
    expect(screen.getByText(chipText)).toHaveAttribute('title', expect.stringContaining('regret 1.69 on the score scale from −1 to 1'));
    expect(screen.queryByText(/−84%/)).toBeNull();
    rerender(<SideRow name="Alice" side={misplayedSide()} />);
    expect(screen.getByText(`mistake · ${winDeltaText(-0.25)}`)).toBeInTheDocument();
  });

  test('a sack note names the other bodies the side lost on the turn (T123 point 10, 912045 t1 shape)', () => {
    const { rerender } = render(<SideRow name="Alice" side={sideAnalysis({ sacrifice: { name: 'Ogerpon', hpFraction: 0.09, alsoFell: ['Rillaboom'] } })} />);
    expect(screen.getByText('· sacked Ogerpon (9% HP), also lost Rillaboom')).toBeInTheDocument();
    rerender(<SideRow name="Alice" side={sideAnalysis({ sacrifice: { name: 'Ogerpon', hpFraction: 0.09 } })} />);
    expect(screen.getByText('· sacked Ogerpon (9% HP)')).toBeInTheDocument();
  });

  test('a blunder reads as a blunder; a setup move softens the chip into a caveat', () => {
    const { rerender } = render(<SideRow name="Alice" side={misplayedSide('blunder')} />);
    expect(screen.getByText(`blunder · ${winDeltaText(-0.5)}`)).toBeInTheDocument();
    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { playedRaw: { kind: 'move', name: 'Swords Dance' }, setupMove: 'Swords Dance' })} />);
    expect(screen.getByText(`${winDeltaText(-0.25)} regret · setup caveat`)).toBeInTheDocument();
  });

  test('an unpunished risk, a paid-off read, a sack, and a deeper verification each get their note', () => {
    const { rerender } = render(<SideRow name="Alice" side={misplayedSide('mistake', { riskUnpunished: true })} />);
    expect(screen.getByText(`${winDeltaText(-0.25)} regret · risk unpunished`)).toBeInTheDocument();
    expect(screen.getByText(`${winPctText(0.15)} safe:`)).toBeInTheDocument();

    rerender(<SideRow name="Alice" side={sideAnalysis({ riskPaidOff: true, riskPayoff: 0.12, safe: rankedChoice('move protect', 'Protect', 0.05) })} />);
    expect(screen.getByText(`read paid off · ${winDeltaText(0.12)}`)).toBeInTheDocument();

    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { sacrifice: { name: 'Toxapex', hpFraction: 0.12 } })} />);
    expect(screen.getByText('· sacked Toxapex (12% HP)')).toBeInTheDocument();
    expect(screen.queryByText(/^mistake ·/)).toBeNull();

    rerender(<SideRow name="Alice" side={sideAnalysis({ verifiedAtDepth: true, tier: 'inaccuracy', regret: 0.12 })} />);
    expect(screen.getByText('· verified deeper')).toBeInTheDocument();
    expect(screen.getByText(`· inaccuracy (${winDeltaText(-0.12)})`)).toBeInTheDocument();
  });

  test('a paid-off read on a turn its side lost shows no praise chip (T59, 912045 t9 shape)', () => {
    const read = sideAnalysis({ riskPaidOff: true, riskPayoff: 0.12, safe: rankedChoice('move protect', 'Protect', 0.05) });
    const { rerender } = render(<SideRow name="Alice" side={read} lostGround />);
    expect(screen.queryByText(/read paid off/)).toBeNull();
    expect(screen.queryByText(/regret/)).toBeNull();
    rerender(<SideRow name="Alice" side={read} />);
    expect(screen.getByText(`read paid off · ${winDeltaText(0.12)}`)).toBeInTheDocument();
  });

  test('a prevented action and an unseen partner are spelled out; the sensitivity note names the guessed item', () => {
    const { rerender } = render(<SideRow name="Alice" side={sideAnalysis({ played: null, playedRaw: null, prevented: 'flinch' })} />);
    expect(screen.getByText('flinched: the chosen action never surfaced')).toBeInTheDocument();
    expect(screen.getByText(/engine:/)).toHaveTextContent(`engine: Earthquake (${winPctText(0.35)})`);

    const sensitivity = { species: 'Kingambit', alternatives: [{ item: 'Leftovers', tier: 'none' as const }, { item: 'Air Balloon', tier: 'mistake' as const }] };
    rerender(<SideRow name="Alice" side={sideAnalysis({ playedPartial: true, sensitivity })} />);
    expect(screen.getByText('· partner unseen')).toBeInTheDocument();
    expect(screen.getByText('± hinges on Kingambit')).toHaveAttribute('title', 'The verdict depends on a guessed item: Leftovers: fine · Air Balloon: mistake');
  });
  test('the hindsight line shows only for a read that cleared the gate (T64), on a clean row and a mistaken one', () => {
    const line = 'Against Iron Head, switching to Heatran was worth +28% more.';
    const read = { response: '→ Heatran', against: 'Iron Head', gain: 0.56 };
    const { rerender } = render(<SideRow name="Alice" side={sideAnalysis({ hindsightRead: { ...read, shown: true, line } })} />);
    expect(screen.getByText(line)).toBeInTheDocument();
    // A read the gate held back (few visits, or too close to the regret) says nothing on the row.
    rerender(<SideRow name="Alice" side={sideAnalysis({ hindsightRead: read })} />);
    expect(screen.queryByText(line)).toBeNull();
    expect(screen.queryByText(/was worth/)).toBeNull();
    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { hindsightRead: { ...read, shown: true, line } })} />);
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  test('an unpunished risk whose safe line did as well against the reply that came says so in the chip title, never "the read came true" (round 89, B6a)', () => {
    const held = { against: 'Toxic', playedValue: 0.189, safeValue: 0.19 };
    const side = misplayedSide('mistake', { riskUnpunished: true, safeAgainstClick: held });
    const { rerender } = render(<SideRow name="Alice" side={side} />);
    const chip = screen.getByText(`${winDeltaText(-0.25)} regret · risk unpunished`);
    expect(chip).toHaveAttribute(
      'title',
      'The floor assumes Leech Seed; the opponent chose Toxic instead, and against that the safe line did as well or better.',
    );
    expect(screen.queryByText(/read paid off/)).toBeNull();
    // Without the field (a result with no matrix) the old title stands.
    rerender(<SideRow name="Alice" side={misplayedSide('mistake', { riskUnpunished: true })} />);
    expect(screen.getByText(`${winDeltaText(-0.25)} regret · risk unpunished`).getAttribute('title')).toContain('so the read came true');
  });

  test('an inaccuracy whose read paid off shows the read alone; the review and the report list it the same way (round 89, G4d)', () => {
    const paid = sideAnalysis({ tier: 'inaccuracy', regret: 0.09, riskPaidOff: true, riskPayoff: 0.09 });
    const { rerender } = render(<SideRow name="Alice" side={paid} />);
    expect(screen.getByText(`read paid off · ${winDeltaText(0.09)}`)).toBeInTheDocument();
    expect(screen.queryByText(/· inaccuracy/)).toBeNull();
    // the side lost ground: the read is not praised, so the inaccuracy stays
    rerender(<SideRow name="Alice" side={paid} lostGround />);
    expect(screen.queryByText(/read paid off/)).toBeNull();
    expect(screen.getByText(`· inaccuracy (${winDeltaText(-0.09)})`)).toBeInTheDocument();
  });

  // Round 89 (X1a part 1, 649664 T24 and T23): "played stayed in (KO'd before acting)" with "✓ the engine's move" printed the engine's
  // description of a stand-in as a choice and ticked it. A body knocked out before it moved has no choice in the log.
  test('singles: a body knocked out before it moved says so, names the stand-in\'s chance and the engine\'s move, and earns no tick', () => {
    const standIn = rankedChoice('move painsplit', 'stayed in (KO’d before acting)', 0.11);
    const best = rankedChoice('move painsplit', 'Pain Split', 0.11);
    render(<SideRow name="Alice" side={sideAnalysis({ playedRaw: null, played: standIn, best, safe: best, neverActed: true, prevented: 'faint' })} />);
    expect(document.body.textContent).not.toMatch(/stayed in|KO’d|played /);
    expect(screen.getByText(/knocked out before it moved/)).toHaveTextContent(`knocked out before it moved, so the log shows no choice · staying in ${winPctText(0.11)}`);
    expect(screen.queryByText(/the engine's move/)).toBeNull();
    expect(screen.getByText(/engine:/)).toHaveTextContent(`engine: Pain Split (${winPctText(0.11)})`);
    expect(screen.queryByText(/risked/)).toBeNull();
  });

  test('singles: a stand-in that is not the engine\'s move still reads as no choice, with the engine\'s move beside it', () => {
    const standIn = rankedChoice('move splash', 'stayed in (KO’d before acting)', -0.1);
    const best = rankedChoice('move painsplit', 'Pain Split', 0.11);
    render(<SideRow name="Alice" side={sideAnalysis({ playedRaw: null, played: standIn, best, safe: best, regret: null, neverActed: true, prevented: 'faint' })} />);
    expect(screen.getByText(/knocked out before it moved/)).toHaveTextContent(`staying in ${winPctText(-0.1)}`);
    expect(screen.getByText(/engine:/)).toHaveTextContent(`engine: Pain Split (${winPctText(0.11)})`);
  });

  test('doubles: the stand-in is a singles reading (a slot choice never makes one), so a side with slots keeps its card', () => {
    const slot = { kind: 'move' as const, name: 'Fake Out' };
    const pair = rankedChoice('move 1, move 2', 'Fake Out → Rillaboom + Protect', 0.2);
    render(<SideRow name="Alice" side={sideAnalysis({ playedRaw: null, playedSlots: [slot, null], played: pair, best: pair, safe: pair })} />);
    expect(screen.getByText(/^played /)).toHaveTextContent(`played Fake Out → Rillaboom + Protect (${winPctText(0.2)})`);
    expect(screen.getByText("✓ the engine's move")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/knocked out before it moved/);
  });
});
