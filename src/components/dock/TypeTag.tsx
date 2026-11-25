export function TypeTag({ type }: { type: string }) {
  return <span className="ps-type-tag">{type || '???'}</span>;
}
