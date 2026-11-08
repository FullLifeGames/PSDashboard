import { useEffect } from 'react';
import { useDockHeight } from '../hooks/useDockHeight';
import { useLeadSelection } from '../hooks/useLeadSelection';
import { LeadSide } from './LeadSide';
import type { LeadOption } from '../lib/lead-options';

interface Props {
  playerNames: [string, string];
  p1Options: LeadOption[];
  p2Options: LeadOption[];
  /** 1 in singles, 2 in doubles — selection order is the slot order (a, b). */
  leadsPerSide: number;
  /** Bring-limited formats (VGC 4 of 6, BSS 3 of 6): total picks per side.
   *  Null brings the whole team, so only the leads are picked. */
  bringCount: number | null;
  /** A lead variation's recorded turn-0 choice: returning to T0 shows THAT
   *  selection instead of the real game's defaults. */
  pickedLeads?: { p1: string[]; p2: string[] } | null;
  /** True while the sim rebuilds or executes — blocks the start button. */
  executing: boolean;
  onStart: (leads: { p1: string[]; p2: string[] }) => void;
  /** The complete selection on screen, null while it is unfinished or the panel leaves (the play-out starts from it). */
  onPicksChange?: (leads: { p1: string[]; p2: string[] } | null) => void;
}

function panelIntro(bringCount: number | null, leadsPerSide: number): string {
  return bringCount !== null
    ? `Turn 0 · team preview: pick the ${bringCount} each side brings. The first ${leadsPerSide > 1 ? `${leadsPerSide} lead` : 'one leads'}, then play the game from the start.`
    : leadsPerSide > 1
      ? 'Turn 0 · team preview: pick both leads per side (selection order is the slot order) and play the game from the start.'
      : 'Turn 0 · team preview: pick each side’s lead and play the game from the start.';
}

/** What Start says: it names what is missing, as Execute does. Both sides short reads "Pick N per side"; one side short reads "Pick k more for P1". */
function startLabel({ executing, ready, maxPicks, p1Picked, p2Picked }: { executing: boolean; ready: boolean; maxPicks: number; p1Picked: number; p2Picked: number }): string {
  if (executing) return 'Preparing…';
  if (ready) return 'Play from turn 0';
  if (p1Picked < maxPicks && p2Picked < maxPicks) return `Pick ${maxPicks} per side`;
  return `Pick ${maxPicks - (p1Picked < maxPicks ? p1Picked : p2Picked)} more for ${p1Picked < maxPicks ? 'P1' : 'P2'}`;
}

/**
 * Turn 0 of the unified timeline: the team-preview decision. Replaces the turn dock while the pointer sits on T0 — pick each
 * side's lead (both slots in doubles) and, in bring-limited formats, the whole brought selection; then play the game from the
 * start as a variation. Round 84 (A7b, ruling 12b): it wears the dock's look and stands where the dock stands: the root is a dock
 * (`ps-dock ps-lead`), the intro is its status strip, P1 and P2 stand in rows of the bench's tiles, and Start takes Execute's place.
 */
export function LeadPanel({ playerNames, p1Options, p2Options, leadsPerSide, bringCount, pickedLeads, executing, onStart, onPicksChange }: Props) {
  const maxPicks = bringCount ?? leadsPerSide;
  const { p1Leads, p2Leads, toggleP1, toggleP2 } = useLeadSelection({ p1Options, p2Options, pickedLeads, maxPicks });
  const reportHeight = useDockHeight();
  const ready = p1Leads.length === maxPicks && p2Leads.length === maxPicks;
  useEffect(() => {
    onPicksChange?.(ready ? { p1: [...p1Leads], p2: [...p2Leads] } : null);
    return () => onPicksChange?.(null);
  }, [ready, p1Leads, p2Leads, onPicksChange]);

  if (p1Options.length === 0 || p2Options.length === 0) {
    return (
      <div className="ps-dock ps-lead">
        <div className="ps-dock-status">Turn 0 · team preview. The teams are still loading.</div>
      </div>
    );
  }

  const idle = ready && !executing;
  return (
    <div className="ps-dock ps-lead" ref={reportHeight}>
      <div className="ps-dock-status">{panelIntro(bringCount, leadsPerSide)}</div>
      <div className="ps-dock-anchor">
        <div className="ps-dock-bar">
          <div className="ps-lead-rows">
            <LeadSide side="p1" label={`P1 · ${playerNames[0]}`} options={p1Options} selected={p1Leads} leadsPerSide={leadsPerSide} maxPicks={maxPicks} onToggle={toggleP1} />
            <LeadSide side="p2" label={`P2 · ${playerNames[1]}`} options={p2Options} selected={p2Leads} leadsPerSide={leadsPerSide} maxPicks={maxPicks} onToggle={toggleP2} />
          </div>
          <button
            type="button"
            onClick={() => ready && onStart({ p1: [...p1Leads], p2: [...p2Leads] })}
            disabled={!ready || executing}
            className={`ps-execute-btn${idle ? ' ps-execute-btn-ready' : ''}`}
          >
            {startLabel({ executing, ready, maxPicks, p1Picked: p1Leads.length, p2Picked: p2Leads.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
