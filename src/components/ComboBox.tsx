import { useEffect, useId, useMemo, useRef, useState } from 'react';

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
  const listRef = useRef<HTMLUListElement>(null);
  const idBase = `ps-combobox-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return options;
    const starts = options.filter(option => option.toLowerCase().startsWith(query));
    const contains = options.filter(option =>
      !option.toLowerCase().startsWith(query) && option.toLowerCase().includes(query));
    return [...starts, ...contains];
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${idBase}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open, idBase]);

  const commit = (option: string) => {
    onSelect(option);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight(current => Math.min(current + 1, Math.min(filtered.length, MAX_VISIBLE_OPTIONS) - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const exact = options.find(option => toId(option) === toId(value));
      if (open && filtered[highlight]) {
        commit(filtered[highlight]);
      } else if (exact) {
        commit(exact);
      } else {
        onEnterFreeText?.(value);
        setOpen(false);
      }
    }
  };

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
        filtered.length > 0 ? (
          <ul className="ps-combobox-pop" role="listbox" id={`${idBase}-list`} ref={listRef}>
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
                onClick={() => commit(option)}
                onMouseEnter={() => setHighlight(index)}
              >
                {option}
              </li>
            ))}
            {filtered.length > MAX_VISIBLE_OPTIONS && (
              <li className="ps-combobox-option ps-combobox-more" aria-hidden="true">
                …{filtered.length - MAX_VISIBLE_OPTIONS} more — keep typing
              </li>
            )}
          </ul>
        ) : value.trim() ? (
          <div className="ps-combobox-pop ps-combobox-empty">No matching option</div>
        ) : null
      )}
    </div>
  );
}
