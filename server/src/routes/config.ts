import type { ConfigResponse } from '@repoready/shared';
import { Router } from 'express';

/** Public, non-secret feature flags the client needs (Addendum 01, 5.5). */
export function createConfigRouter(config: ConfigResponse): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json(config);
  });
  return router;
}
