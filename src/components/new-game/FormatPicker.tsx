import { useId, useMemo, useRef, useState } from 'react';
import { formatNote, searchGroups } from '../../lib/new-game/format-list';
import type { FormatGroup, FormatOption } from '../../lib/new-game/format-options';

/**
 * Round 89 (lane H, #105), stage H4: the format list of the New game dialog. A button shows the chosen format and opens the list: a
 * search field on top, the groups under it as Showdown's format picker draws them, the arrow keys, Enter and Escape as the app's
 * ComboBox has them. The list is the simulator's whole list; the groups arrive ready (`panelGroups`).
 */

interface Props {
  groups: readonly FormatGroup[];
  value: string;
  onSelect: (option: FormatOption) => void;
  /** The format's one-line note (the rule table's); injected so the picker stays a view. */
  note?: (option: FormatOption) => string;
  disabled?: boolean;
}

type Row = { kind: 'group'; label: string } | { kind: 'option'; option: FormatOption; index: number };

/** The flat rows of the visible list: a heading before each group, the options numbered for the keyboard. */
function rowsOf(groups: readonly FormatGroup[]): { rows: Row[]; options: FormatOption[] } {
  const rows: Row[] = [];
  const options: FormatOption[] = [];
  for (const group of groups) {
    rows.push({ kind: 'group', label: group.label });
    for (const option of group.options) {
      rows.push({ kind: 'option', option, index: options.length });
      options.push(option);
    }
  }
  return { rows, options };
}

/** The list's state: open, the search text, the highlighted option; the keys that move it. */
function useFormatPicker(groups: readonly FormatGroup[], value: string, onSelect: (option: FormatOption) => void, buttonRef: React.RefObject<HTMLButtonElement | null>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const shown = useMemo(() => searchGroups(groups, query), [groups, query]);
  const { rows, options } = useMemo(() => rowsOf(shown), [shown]);
  const close = () => {
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };
  const commit = (option: FormatOption) => {
    onSelect(option);
    close();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight(current => Math.min(current + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(current => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (options[highlight]) commit(options[highlight]);
    } else if (event.key === 'Escape') {
      // The dialog's own Escape closes the whole dialog: this one only closes the list.
      event.stopPropagation();
      close();
    }
  };
  const toggle = () => {
    setOpen(current => !current);
    setHighlight(Math.max(0, options.findIndex(option => option.id === value)));
  };
  const search = (text: string) => {
    setQuery(text);
    setHighlight(0);
  };
  const dismiss = () => {
    setOpen(false);
    setQuery('');
  };
  return { open, query, highlight, setHighlight, rows, options, commit, onKeyDown, toggle, search, dismiss };
}

type PickerState = ReturnType<typeof useFormatPicker>;

/** A stable ref callback: it runs once when the list mounts, not on every hover. */
const bringIntoView = (element: HTMLDivElement | null): void => element?.scrollIntoView?.({ block: 'nearest' });

function FormatList({ picker, idBase, value, total, note }: { picker: PickerState; idBase: string; value: string; total: number; note: (option: FormatOption) => string }) {
  const { rows, options, highlight, query } = picker;
  return (
    // the search field keeps focus while the list is used (a click on a scroll bar or a heading must not blur it)
    <div
      className="ps-combobox-pop ps-format-pop"
      // the dialog scrolls and the list hangs below the button: bring the whole list, its footnote included, into the dialog's view
      ref={bringIntoView}
      onMouseDown={event => { if (event.target !== event.currentTarget.firstChild) event.preventDefault(); }}>
      <input
        className="ps-input"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${idBase}-list`}
        aria-activedescendant={options[highlight] ? `${idBase}-${highlight}` : undefined}
        aria-label="Search formats"
        placeholder={`Search ${total} formats`}
        value={query}
        autoFocus
        onChange={event => picker.search(event.target.value)}
        onKeyDown={picker.onKeyDown}
        onBlur={picker.dismiss}
      />
      <ul className="ps-format-list" role="listbox" id={`${idBase}-list`} aria-label="Formats">
        {rows.map(row => row.kind === 'group' ? (
          <li key={`group-${row.label}`} className="ps-combobox-group" role="presentation">{row.label}</li>
        ) : (
          <li
            key={row.option.id}
            id={`${idBase}-${row.index}`}
            role="option"
            aria-selected={row.option.id === value}
            className={`ps-combobox-option${row.index === highlight ? ' ps-combobox-option-active' : ''}`}
            // the search field keeps focus, so a click cannot blur it first
            onMouseDown={event => event.preventDefault()}
            onClick={() => picker.commit(row.option)}
            onMouseEnter={() => picker.setHighlight(row.index)}
          >
            <span>{row.option.name}</span>
            <span className="ps-combobox-note">{note(row.option)}</span>
          </li>
        ))}
        {options.length === 0 && <li className="ps-combobox-group" role="presentation">No matching format</li>}
      </ul>
      <div className="ps-format-count">
        {total} formats of the simulator, Champions included. Formats that build their own teams (Random Battle, Factory, Hackmons Cup) are left out.
      </div>
    </div>
  );
}

export function FormatPicker({ groups, value, onSelect, note = formatNote, disabled = false }: Props) {
  const idBase = `ps-format-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const picker = useFormatPicker(groups, value, onSelect, buttonRef);
  const total = useMemo(() => groups.reduce((sum, group) => sum + group.options.length, 0), [groups]);
  const selected = useMemo(() => groups.flatMap(group => group.options).find(option => option.id === value), [groups, value]);
  return (
    <div className="ps-newgame-picker">
      <button
        ref={buttonRef}
        type="button"
        className="ps-input ps-format-btn"
        aria-haspopup="listbox"
        aria-expanded={picker.open}
        id={`${idBase}-button`}
        aria-labelledby={`ps-newgame-format-label ${idBase}-button`}
        disabled={disabled}
        onClick={picker.toggle}
      >
        {selected?.name ?? (disabled ? 'Loading formats…' : value)} <span aria-hidden="true">▾</span>
      </button>
      {picker.open && <FormatList picker={picker} idBase={idBase} value={value} total={total} note={note} />}
    </div>
  );
}
