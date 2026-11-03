import { useId } from 'react';
import { useUiScale } from '../hooks/useUiScale';
import { UI_SCALE_STEPS, scaleLabel, stepDisabledReason, type UiScaleSetting } from '../lib/ui-scale';
import { setUiScaleSetting } from '../lib/ui-scale-store';

/** The select's value of a setting: "auto" or the step as written in storage. */
const valueOf = (setting: UiScaleSetting): string => String(setting);

/**
 * Round 84 (T315, A7d, spec addendum A, 6a): the "Size" select of the Setup menu. Auto names the step it gives for this window; the
 * five steps override it and persist per browser (`ui-scale-store.ts`). A step that would leave the app less than 1050 px of width
 * is disabled, and its label says how wide a window it needs.
 */
export function SizeSelect() {
  const { setting, auto, width } = useUiScale();
  const id = useId();
  return (
    <label className="ps-setup-size" htmlFor={id}>
      Size
      <select
        id={id}
        className="ps-setup-size-select"
        value={valueOf(setting)}
        onChange={event => setUiScaleSetting(event.target.value === 'auto' ? 'auto' : (Number(event.target.value) as UiScaleSetting))}
      >
        <option value="auto">{`Auto (${scaleLabel(auto)})`}</option>
        {UI_SCALE_STEPS.map(step => {
          const reason = stepDisabledReason(step, width);
          return (
            <option key={step} value={valueOf(step)} disabled={reason !== null}>
              {reason === null ? scaleLabel(step) : `${scaleLabel(step)} (${reason.charAt(0).toLowerCase()}${reason.slice(1)})`}
            </option>
          );
        })}
      </select>
    </label>
  );
}
