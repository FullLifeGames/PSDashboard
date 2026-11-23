import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type { NewGameDialog } from './NewGameDialog';

/**
 * Loads the New game dialog when it is first asked for and keeps it mounted (its draft survives a close): the start load holds no simulator code
 * (`test/e2e-build/build-smoke.spec.ts`), and a static import of the dialog from the app's root would put it there.
 */
const Dialog = lazy(() => import('./NewGameDialog').then(loaded => ({ default: loaded.NewGameDialog })));

export function LazyNewGameDialog(props: ComponentProps<typeof NewGameDialog>) {
  const [asked, setAsked] = useState(props.open);
  if (props.open && !asked) setAsked(true);
  if (!asked) return null;
  return <Suspense fallback={null}><Dialog {...props} /></Suspense>;
}
