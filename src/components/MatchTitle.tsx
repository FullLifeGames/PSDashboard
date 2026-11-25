/** The tag and the names clip with an ellipsis; `.ps-topbar-match` in `layout.css` orders the shrinking. */
export function MatchTitle({ format, players, newGame = false }: { format: string; players: readonly string[]; newGame?: boolean }) {
  return (
    <>
      {newGame && <span className="ps-format-tag ps-newgame-tag">New game</span>}
      <span className="ps-format-tag" title={format}>{format}</span>
      <span className="ps-player" title={players[0]} style={{ fontSize: 11, color: '#8ac' }}>{players[0]}</span>
      <span style={{ fontSize: 10, color: '#556', flexShrink: 0 }}>vs</span>
      <span className="ps-player" title={players[1]} style={{ fontSize: 11, color: '#c8a' }}>{players[1]}</span>
    </>
  );
}
