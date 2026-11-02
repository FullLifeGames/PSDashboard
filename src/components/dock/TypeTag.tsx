/** Round 84 (turn dock): a move's type on the tile's own type color (`--type` and `--type-on` come from `typeTileVars`). */
export function TypeTag({ type }: { type: string }) {
  return <span className="ps-type-tag">{type || '???'}</span>;
}
