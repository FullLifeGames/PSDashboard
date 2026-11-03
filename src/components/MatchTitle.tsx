/**
 * Round 84 (A7f, ruling 19a): the format tag, the two player names and the "vs" between them, as the top bar and the shared
 * branch view both show them. The tag and the names clip with an ellipsis (`.ps-topbar-match` in `layout.css` orders the shrinking:
 * the tag first, the names next) and carry their full text in a title.
 */
export function MatchTitle({ format, players }: { format: string; players: readonly string[] }) {
  return (
    <>
      <span className="ps-format-tag" title={format}>{format}</span>
      <span className="ps-player" title={players[0]} style={{ fontSize: 11, color: '#8ac' }}>{players[0]}</span>
      <span style={{ fontSize: 10, color: '#556', flexShrink: 0 }}>vs</span>
      <span className="ps-player" title={players[1]} style={{ fontSize: 11, color: '#c8a' }}>{players[1]}</span>
    </>
  );
}
