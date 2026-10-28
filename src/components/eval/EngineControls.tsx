import { useState } from 'react';
import { ModalDialog } from '../ModalDialog';
import { engineUrlProblem, type EngineEntry } from '../../lib/engines/registry';

const LABEL_STYLE = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' } as const;

interface EngineControlsProps {
  engines: EngineEntry[];
  selected: EngineEntry;
  running: boolean;
  onSelect: (id: string) => void;
  onAdd: (name: string, url: string) => void;
  onRemove: (id: string) => void;
}

/** The engines this browser added, each removable, and the form that adds one by address. */
function AddEngineDialog({ engines, onAdd, onRemove, onClose }: Pick<EngineControlsProps, 'engines' | 'onAdd' | 'onRemove'> & { onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const added = engines.filter(engine => engine.source === 'added');
  const submit = () => {
    const issue = name.trim() === '' ? 'Give the engine a name.' : engineUrlProblem(url.trim());
    if (issue) {
      setProblem(issue);
      return;
    }
    onAdd(name.trim(), url.trim());
    onClose();
  };
  return (
    <ModalDialog title="Add an engine" closeLabel="Close" onClose={onClose}>
      <p style={{ fontSize: 11, color: '#cdd', marginTop: 0 }}>
        An engine answers the PS Dashboard engine protocol over HTTP (ENGINES.md in the repository). Positions you
        evaluate are sent to its address; check it with <code>npx @fulllifegames/eval-engine check-engine &lt;address&gt;</code>.
      </p>
      <label style={{ ...LABEL_STYLE, marginBottom: 6 }}>
        Name
        <input type="text" aria-label="Name" value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label style={{ ...LABEL_STYLE, marginBottom: 6 }}>
        Address
        <input type="text" aria-label="Address" placeholder="http://localhost:8765/" value={url} onChange={event => setUrl(event.target.value)} />
      </label>
      {problem && <div role="alert" style={{ fontSize: 11, color: '#f3a6a6', marginBottom: 6 }}>{problem}</div>}
      <button type="button" className="ps-btn" onClick={submit}>Add engine</button>
      {added.length > 0 && (
        <ul style={{ fontSize: 11, paddingLeft: 16 }}>
          {added.map(engine => (
            <li key={engine.id}>
              {engine.name} <span style={{ color: '#889' }}>{engine.url}</span>{' '}
              <button type="button" className="ps-support-link" aria-label={`Remove ${engine.name}`} onClick={() => onRemove(engine.id)}>remove</button>
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  );
}

/**
 * Round 77 (user gate 28.10.2026, 4a and 5a): the engine choice of the Evaluation panel. The dropdown
 * shows once another engine is integrated; "+ engine" adds one by address in this browser.
 */
export function EngineControls({ engines, selected, running, onSelect, onAdd, onRemove }: EngineControlsProps) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      {engines.length > 1 && (
        <label style={LABEL_STYLE} title="Which engine evaluates: the dashboard's own search or another one (ENGINES.md).">
          Engine
          <select aria-label="Engine" value={selected.id} disabled={running} onChange={event => onSelect(event.target.value)}>
            {engines.map(engine => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="ps-support-link" style={{ fontSize: 10 }} onClick={() => setAdding(true)}>+ engine</button>
      {adding && <AddEngineDialog engines={engines} onAdd={onAdd} onRemove={onRemove} onClose={() => setAdding(false)} />}
    </>
  );
}
