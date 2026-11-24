import { useEffect } from 'react';
import { useDockHeight } from '../hooks/useDockHeight';
import { useLeadSelection } from '../hooks/useLeadSelection';
import { LeadSide } from './LeadSide';
import type { LeadOption } from '../lib/lead-options';
import type { Side } from './dock/dock-model';

interface Props {
  playerNames: [string, string];
  p1Options: LeadOption[];
  p2Options: LeadOption[];
  leadsPerSide: number;
  /** Total picks per side in bring-limited formats (VGC 4 of 6); null brings the whole team. */
  bringCount: number | null;
  pickedLeads?: { p1: string[]; p2: string[] } | null;
  executing: boolean;
  onStart: (leads: { p1: string[]; p2: string[] }) => void;
  /** The complete selection, null while it is unfinished or when the panel leaves. */
  onPicksChange?: (leads: { p1: string[]; p2: string[] } | null) => void;
  nearSide?: Side;
  /** False for a format without Team Preview (Gens 1 to 4); a replay keeps the default. */
  teamPreview?: boolean;
}

function panelIntro(bringCount: number | null, leadsPerSide: number, teamPreview: boolean): string {
  if (!teamPreview) {
    return leadsPerSide > 1
      ? 'Turn 0 · this format has no team preview: pick both leads per side (selection order is the slot order), they move to the front of their teams. Then play the game from the start.'
      : 'Turn 0 · this format has no team preview: pick each side’s lead, it moves to the front of its team. Then play the game from the start.';
  }
  return bringCount !== null
    ? `Turn 0 · team preview: pick the ${bringCount} each side brings. The first ${leadsPerSide > 1 ? `${leadsPerSide} lead` : 'one leads'}, then play the game from the start.`
    : leadsPerSide > 1
      ? 'Turn 0 · team preview: pick both leads per side (selection order is the slot order) and play the game from the start.'
      : 'Turn 0 · team preview: pick each side’s lead and play the game from the start.';
}

function startLabel({ executing, ready, maxPicks, p1Picked, p2Picked }: { executing: boolean; ready: boolean; maxPicks: number; p1Picked: number; p2Picked: number }): string {
  if (executing) return 'Preparing…';
  if (ready) return 'Play from turn 0';
  if (p1Picked < maxPicks && p2Picked < maxPicks) return `Pick ${maxPicks} per side`;
  return `Pick ${maxPicks - (p1Picked < maxPicks ? p1Picked : p2Picked)} more for ${p1Picked < maxPicks ? 'P1' : 'P2'}`;
}

export function LeadPanel({ playerNames, p1Options, p2Options, leadsPerSide, bringCount, pickedLeads, executing, onStart, onPicksChange, nearSide = 'p1', teamPreview = true }: Props) {
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
  const sides: Side[] = nearSide === 'p2' ? ['p2', 'p1'] : ['p1', 'p2'];
  return (
    <div className="ps-dock ps-lead" ref={reportHeight}>
      <div className="ps-dock-status">{panelIntro(bringCount, leadsPerSide, teamPreview)}</div>
      <div className="ps-dock-anchor">
        <div className="ps-dock-bar">
          <div className="ps-lead-rows">
            {sides.map(side => (
              <LeadSide key={side} side={side} label={`${side === 'p1' ? 'P1' : 'P2'} · ${playerNames[side === 'p1' ? 0 : 1]}`} options={side === 'p1' ? p1Options : p2Options} selected={side === 'p1' ? p1Leads : p2Leads} leadsPerSide={leadsPerSide} maxPicks={maxPicks} onToggle={side === 'p1' ? toggleP1 : toggleP2} />
            ))}
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
