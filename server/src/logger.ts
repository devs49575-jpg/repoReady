import { pino, type DestinationStream, type Logger } from 'pino';
import { sanitizeError } from './utils/sanitize';

export type { Logger };

/**
 * Creates the app logger. Pass a destination stream to capture output (tests); otherwise logs go
 * to stdout, pretty-printed in development.
 */
export function createLogger(destination?: DestinationStream, level?: string): Logger {
  const env = process.env.NODE_ENV;
  const options = {
    level: level ?? (env === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info')),
    // Defense in depth: request headers are not logged at all (see app.ts), but if a header or
    // config object ever slips into a log call, these paths are still censored.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-github-token"]',
        'headers.authorization',
        'headers["x-github-token"]',
        '*.GITHUB_TOKEN',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    // Errors lose URL query strings and private report ids. Callers that hold a user token must
    // still pass it to sanitizeError() themselves before logging.
    serializers: { err: (err: unknown) => sanitizeError(err) },
  };

  if (destination) return pino(options, destination);
  if (env !== 'production' && env !== 'test') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' },
      },
    });
  }
  return pino(options);
}

export const logger = createLogger();
