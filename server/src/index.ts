import { ARCHITECTURE_LIMITS } from './analyzers/architecture';
import { createApp } from './app';
import { getConfig } from './config';
import { connectDb, disconnectDb } from './db';
import { logger } from './logger';
import { JobQueue } from './queue/jobQueue';
import { createGitHubClient } from './services/github';
import { cleanupActiveDirsSync, sweepTempRoot } from './services/repoFetcher';
import { MemoryAnalysisStore } from './stores/memoryStore';
import { MongoAnalysisStore, failStaleAnalyses } from './stores/mongoStore';

const JOB_CONCURRENCY = 2;

async function main(): Promise<void> {
  const config = getConfig();
  ARCHITECTURE_LIMITS.maxOldGenerationSizeMb = config.ARCHITECTURE_MAX_MEMORY_MB;
  await connectDb(config.MONGODB_URI);

  const stale = await failStaleAnalyses();
  const swept = await sweepTempRoot();
  if (stale || swept) logger.info({ stale, swept }, 'Cleaned up after previous run');

  // Private reports live only in this process (single-instance assumption, Addendum 01).
  const privateStore = config.PRIVATE_MODE_ENABLED
    ? new MemoryAnalysisStore({
        ttlMinutes: config.PRIVATE_REPORT_TTL_MINUTES,
        maxEntries: config.MAX_PRIVATE_REPORTS,
      })
    : undefined;

  const app = createApp({
    clientOrigin: config.CLIENT_ORIGIN,
    analyses: {
      publicGitHub: createGitHubClient(config.GITHUB_TOKEN, { mode: 'public' }),
      stores: { public: new MongoAnalysisStore(), private: privateStore },
      queue: new JobQueue(JOB_CONCURRENCY, config.ANALYSIS_TIMEOUT_MS),
      maxRepoSizeKb: config.MAX_REPO_SIZE_KB,
      cacheTtlHours: config.CACHE_TTL_HOURS,
      privateMode: {
        enabled: config.PRIVATE_MODE_ENABLED,
        requireHttps: config.NODE_ENV === 'production',
      },
    },
    rateLimits: {
      createsPerHour: config.RATE_LIMIT_CREATES_PER_HOUR,
      readsPerMinute: config.RATE_LIMIT_READS_PER_MINUTE,
    },
    publicConfig: {
      privateModeEnabled: config.PRIVATE_MODE_ENABLED,
      privateReportTtlMinutes: config.PRIVATE_REPORT_TTL_MINUTES,
    },
  });
  const server = app.listen(config.PORT, () => {
    logger.info(`RepoReady API listening on http://localhost:${config.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    cleanupActiveDirsSync();
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', cleanupActiveDirsSync);
}

main().catch((err: unknown) => {
  logger.fatal(err instanceof Error ? err.message : err, 'Failed to start server');
  process.exit(1);
});
