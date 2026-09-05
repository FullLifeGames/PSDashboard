import { useEffect, useState } from 'react';
import { ReplayWorkerClient } from '../lib/replay-jobs/client';

/**
 * The app's replay worker (round 38): every spread solve and every
 * reconstruction runs through this one client, so the main thread never
 * computes either. Disposal terminates the worker and rejects open jobs;
 * the client stays usable and spawns anew on the next job (StrictMode's
 * mount-unmount-mount included).
 */
export function useReplayWorker(): ReplayWorkerClient {
  const [client] = useState(() => new ReplayWorkerClient());
  useEffect(() => () => client.dispose(), [client]);
  return client;
}
