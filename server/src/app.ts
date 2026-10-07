import type { ApiErrorBody, ConfigResponse } from '@repoready/shared';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger as defaultLogger, type Logger } from './logger';
import { type AnalysesDeps, createAnalysesRouter } from './routes/analyses';
import { createBadgeRouter } from './routes/badge';
import { createConfigRouter } from './routes/config';
import { healthRouter } from './routes/health';
import { AppError, isAppError } from './utils/errors';
import { sanitizeText } from './utils/sanitize';

export interface AppOptions {
  clientOrigin: string;
  logger?: Logger;
  /** Omitted in tests that only exercise middleware. */
  analyses?: Omit<AnalysesDeps, 'logger'>;
  /** Non-secret feature flags served at GET /api/config. */
  publicConfig?: ConfigResponse;
  /** Per-IP limits (Section 10). Each app instance has its own in-memory counters. */
  rateLimits?: { createsPerHour: number; readsPerMinute: number };
}

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Same error shape as every other API error.
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', message)),
  });
}

export function createApp({
  clientOrigin,
  logger = defaultLogger,
  analyses,
  publicConfig = { privateModeEnabled: false, privateReportTtlMinutes: 60 },
  rateLimits = { createsPerHour: 10, readsPerMinute: 120 },
}: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind one proxy on Render/Railway; makes req.secure and req.ip correct
  app.use(helmet());
  app.use(
    cors({
      origin: clientOrigin,
      // X-GitHub-Token carries the user's token for private repo mode; without it preflight fails.
      allowedHeaders: ['Content-Type', 'X-GitHub-Token'],
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Never log headers, bodies or query strings: any of them can carry the user's GitHub token.
      // The path is scrubbed because private report ids in it are access secrets.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: sanitizeText(req.url.split('?')[0] ?? ''),
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Creations count every attempt, public or private, successful or not (slows token guessing).
  const createLimiter = limiter(
    60 * 60_000,
    rateLimits.createsPerHour,
    'You have started a lot of analyses. Please wait a bit and try again.',
  );
  const readLimiter = limiter(
    60_000,
    rateLimits.readsPerMinute,
    'Too many requests. Please slow down.',
  );

  app.use('/api/health', healthRouter);
  app.use('/api/config', readLimiter, createConfigRouter(publicConfig));
  if (analyses) {
    app.post('/api/analyses', createLimiter);
    app.get('/api/analyses{/*rest}', readLimiter);
    app.use('/api/analyses', createAnalysesRouter({ ...analyses, logger }));
    // Not read-limited: README badges are fetched by GitHub's image proxy from a few shared IPs,
    // and responses are cacheable for 5 minutes.
    app.use('/api/badge', createBadgeRouter(analyses.stores.public));
  }

  app.use('/api', (req, _res, next) => {
    next(new AppError('NOT_FOUND', `No route for ${req.method} ${sanitizeText(req.path)}`));
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    let appError: AppError;
    if (isAppError(err)) {
      appError = err;
    } else if (err instanceof SyntaxError && 'body' in err) {
      appError = new AppError('VALIDATION_ERROR', 'Request body is not valid JSON');
    } else {
      req.log.error({ err }, 'Unhandled error');
      appError = new AppError('INTERNAL_ERROR', 'Something went wrong');
    }
    const body: ApiErrorBody = { error: { code: appError.code, message: appError.message } };
    res.status(appError.status).json(body);
  };
  app.use(errorHandler);

  return app;
}
