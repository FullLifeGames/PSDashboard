import { useEffect, useId, useMemo, useState } from 'react';

interface Props {
  options: string[];
  value: string;
  /** Fires on every keystroke with the raw text. */
  onChange: (text: string) => void;
  /** Fires when an option is committed — by click or by Enter. */
  onSelect: (option: string) => void;
  /** Enter pressed while the text matches no option (free-text fallback). */
  onEnterFreeText?: (text: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  inputStyle?: React.CSSProperties;
}

const MAX_VISIBLE_OPTIONS = 100;

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Prefix matches first, then substring matches; the raw list for an empty query. */
function filterOptions(options: string[], value: string): string[] {
  const query = value.trim().toLowerCase();
  if (!query) return options;
  const starts = options.filter(option => option.toLowerCase().startsWith(query));
  const contains = options.filter(option =>
    !option.toLowerCase().startsWith(query) && option.toLowerCase().includes(query));
  return [...starts, ...contains];
}

interface KeyContext {
  open: boolean;
  filtered: string[];
  highlight: number;
  options: string[];
  value: string;
  setOpen: (open: boolean) => void;
  setHighlight: (update: (current: number) => number) => void;
  commit: (option: string) => void;
  onEnterFreeText?: (text: string) => void;
}

/** Arrow keys move the highlight, Escape closes, Enter commits the highlighted or exact option (else free text). */
function comboKeyHandler(ctx: KeyContext) {
  return (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      ctx.setOpen(true);
      ctx.setHighlight(current => Math.min(current + 1, Math.min(ctx.filtered.length, MAX_VISIBLE_OPTIONS) - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      ctx.setHighlight(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Escape') {
      ctx.setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const exact = ctx.options.find(option => toId(option) === toId(ctx.value));
      if (ctx.open && ctx.filtered[ctx.highlight]) {
        ctx.commit(ctx.filtered[ctx.highlight]);
      } else if (exact) {
        ctx.commit(exact);
      } else {
        ctx.onEnterFreeText?.(ctx.value);
        ctx.setOpen(false);
      }
    }
  };
}

function ComboBoxPopup({ idBase, filtered, highlight, value, onCommit, onHighlight }: {
  idBase: string;
  filtered: string[];
  highlight: number;
  value: string;
  onCommit: (option: string) => void;
  onHighlight: (index: number) => void;
}) {
  if (filtered.length > 0) {
    return (
      <ul className="ps-combobox-pop" role="listbox" id={`${idBase}-list`}>
        {filtered.slice(0, MAX_VISIBLE_OPTIONS).map((option, index) => (
          <li
            key={option}
            id={`${idBase}-${index}`}
            role="option"
            aria-selected={index === highlight}
            className={`ps-combobox-option${index === highlight ? ' ps-combobox-option-active' : ''}`}
            // preventDefault keeps the input focused so blur cannot close
            // the popup before the click lands.
            onMouseDown={event => event.preventDefault()}
            onClick={() => onCommit(option)}
            onMouseEnter={() => onHighlight(index)}
          >
            {option}
          </li>
        ))}
        {filtered.length > MAX_VISIBLE_OPTIONS && (
          <li className="ps-combobox-option ps-combobox-more" aria-hidden="true">
            …{filtered.length - MAX_VISIBLE_OPTIONS} more; keep typing
          </li>
        )}
      </ul>
    );
  }
  return value.trim() ? (
    <div className="ps-combobox-pop ps-combobox-empty">No matching option</div>
  ) : null;
}

/**
 * Filterable single-select dropdown with proper commit semantics — clicking
 * an option selects it immediately, arrows + Enter work, no hidden
 * "press Enter to confirm" step. Replaces the browser-dependent <datalist>.
 */
export function ComboBox({
  options,
  value,
  onChange,
  onSelect,
  onEnterFreeText,
  onBlur,
  placeholder,
  ariaLabel,
  disabled = false,
  inputStyle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const idBase = `ps-combobox-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;

  const filtered = useMemo(() => filterOptions(options, value), [options, value]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${idBase}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open, idBase]);

  const commit = (option: string) => {
    onSelect(option);
    setOpen(false);
  };

  const handleKeyDown = comboKeyHandler({ open, filtered, highlight, options, value, setOpen, setHighlight, commit, onEnterFreeText });

  return (
    <div className="ps-combobox">
      <input
        className="ps-input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${idBase}-list`}
        aria-activedescendant={open && filtered[highlight] ? `${idBase}-${highlight}` : undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        style={inputStyle}
        onChange={event => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          setOpen(true);
          setHighlight(0);
        }}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
      />
      {open && !disabled && (
        <ComboBoxPopup idBase={idBase} filtered={filtered} highlight={highlight} value={value} onCommit={commit} onHighlight={setHighlight} />
      )}
    </div>
  );
}
