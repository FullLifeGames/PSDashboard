import { useEffect, useState } from 'react';
import { ReplayWorkerClient } from '../lib/replay-jobs/client';

/** The replay worker client (solves, reconstructions); disposal rejects open jobs and the next job respawns it. */
export function useReplayWorker(): ReplayWorkerClient {
  const [client] = useState(() => new ReplayWorkerClient());
  useEffect(() => () => client.dispose(), [client]);
  return client;
}
