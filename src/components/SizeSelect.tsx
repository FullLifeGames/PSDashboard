import { useId } from 'react';
import { useUiScale } from '../hooks/useUiScale';
import { UI_SCALE_STEPS, scaleLabel, stepDisabledReason, type UiScaleSetting } from '../lib/ui-scale';
import { setUiScaleSetting } from '../lib/ui-scale-store';

const valueOf = (setting: UiScaleSetting): string => String(setting);

/** Auto names the step it gives for this window; the steps persist per browser (`ui-scale-store.ts`). */
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
