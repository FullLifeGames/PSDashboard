import { useSyncExternalStore } from 'react';
import { getUiScaleState, subscribeUiScale, type UiScaleState } from '../lib/ui-scale-store';

/**
 * The app's size for a component that shows or sets it (the Size select of the Setup menu). The store applies the factor to the
 * root and follows the window; this hook only reads it.
 */
export function useUiScale(): UiScaleState {
  return useSyncExternalStore(subscribeUiScale, getUiScaleState);
}
