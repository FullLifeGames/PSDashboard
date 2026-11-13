import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type { NewGameDialog } from './NewGameDialog';

/**
 * Round 89 (lane H, #105): the New game dialog reads the simulator's format list and rule tables, so it loads when it is first
 * asked for and stays mounted after that (its draft survives a close). The start load holds no simulator code
 * (`test/e2e-build/build-smoke.spec.ts`), and a static import of the dialog from the app's root would put it there.
 */
const Dialog = lazy(() => import('./NewGameDialog').then(loaded => ({ default: loaded.NewGameDialog })));

export function LazyNewGameDialog(props: ComponentProps<typeof NewGameDialog>) {
  // asked for once: the state follows the prop, reconciled in render
  const [asked, setAsked] = useState(props.open);
  if (props.open && !asked) setAsked(true);
  if (!asked) return null;
  return <Suspense fallback={null}><Dialog {...props} /></Suspense>;
}
