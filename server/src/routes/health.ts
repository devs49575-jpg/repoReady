import type { HealthResponse } from '@repoready/shared';
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = { ok: true };
  res.json(body);
});
