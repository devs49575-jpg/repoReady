import { Router } from 'express';
import { buildBadgeSvg } from '../services/badge';
import type { PublicAnalysisStore } from '../stores';

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * GET /api/badge/:owner/:repo.svg: the latest public score as an SVG badge.
 * Only the public (Mongo) store is consulted, and its query excludes private repos, so a private
 * repo's score can never be exposed (Addendum 01, Section 7).
 */
export function createBadgeRouter(store: PublicAnalysisStore): Router {
  const router = Router();
  router.get('/:owner/:repo.svg', async (req, res) => {
    const { owner, repo } = req.params;
    const score =
      NAME_RE.test(owner) && NAME_RE.test(repo)
        ? await store.latestScore(`${owner}/${repo}`)
        : null;
    res.type('image/svg+xml');
    res.set('Cache-Control', 'public, max-age=300');
    // Badges are embedded on other sites (README pages); helmet's default would block that.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buildBadgeSvg(score));
  });
  return router;
}
