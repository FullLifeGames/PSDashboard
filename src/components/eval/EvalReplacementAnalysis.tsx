import {
  analyzeReplacements, replacementSpeciesOf, winPctText, type ReplacementEvalData, type ReplacementSideAnalysis,
} from '@fulllifegames/eval-engine';
import { evTitle } from './turn-copy';

/** A note on the card of the turn after a knockout: what the player sent in with its win chance, then the engine's pick. Nothing is graded. */

const joined = (species: string[]) => species.join(' and ');

function sentenceOf(name: string, played: string[], side: ReplacementSideAnalysis, faintedFraction: number | null | undefined): string {
  const sent = joined(played);
  if (side.onlyChoice) return `${name} had only ${sent} left.`;
  if (!side.played) return `${name} sent in ${sent}. The engine's list does not price that pick.`;
  const own = `${name} sent in ${sent} (${winPctText(side.played.ev, faintedFraction)}).`;
  if (side.agrees || !side.best) return `${own} That matches the engine.`;
  return `${own} The engine would have sent ${joined(replacementSpeciesOf(side.best.label))} (${winPctText(side.best.ev, faintedFraction)}).`;
}

export function EvalReplacementAnalysis({ turn, records, playerNames, faintedFraction }: {
  turn: number;
  records: ReplacementEvalData[];
  playerNames: [string, string];
  faintedFraction?: number | null;
}) {
  const lines = records.flatMap((record, index) => {
    const analysis = analyzeReplacements(record);
    return (['p1', 'p2'] as const).flatMap(side => {
      const analyzed = analysis[side];
      if (!analyzed) return [];
      const name = playerNames[side === 'p1' ? 0 : 1];
      return [{
        key: `${record.ordinal}-${side}`, name,
        text: `${index > 0 ? 'Then ' : ''}${sentenceOf(name, record.played[side], analyzed, faintedFraction)}`,
      }];
    });
  });
  if (lines.length === 0) return null;
  return (
    // Its own root class: `.ps-eval-analysis` names the turn's card, and a second match broke the panel's locators.
    <div className="ps-eval-replacement">
      <div className="ps-eval-analysis-row">
        <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Before turn {turn}</span>
        <span style={{ color: '#778' }}>the replacement after a knockout</span>
      </div>
      {lines.map(line => (
        <div key={line.key} className="ps-eval-analysis-row" style={{ color: '#aab' }} title={evTitle(line.name)}>{line.text}</div>
      ))}
    </div>
  );
}
