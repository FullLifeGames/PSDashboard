import { useSyncExternalStore } from 'react';
import { getUiScaleState, subscribeUiScale, type UiScaleState } from '../lib/ui-scale-store';

/** The app's size for a component that shows or sets it; the store applies the factor to the root. */
export function useUiScale(): UiScaleState {
  return useSyncExternalStore(subscribeUiScale, getUiScaleState);
}
