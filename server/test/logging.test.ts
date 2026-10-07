import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/logger';

const TOKEN = 'github_pat_TESTSECRET0123456789';
const PRIVATE_ID = 'p_V1StGXR8_Z5jdHi6B-myTV1StGXR8_Z5';

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: createLogger(stream, 'debug'), output: () => lines.join('') };
}

describe('request logging', () => {
  it('never logs the GitHub token header, auth headers, or full private ids', async () => {
    const { logger, output } = captureLogs();
    const app = createApp({ clientOrigin: 'http://localhost:5173', logger });

    const res = await request(app)
      .get(`/api/analyses/${PRIVATE_ID}?token=${TOKEN}`)
      .set('X-GitHub-Token', TOKEN)
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Cookie', `session=${TOKEN}`);

    const logs = output();
    expect(logs).toContain('"statusCode":404'); // the request was logged...
    expect(logs).toContain('p_V1St…'); // ...with a truncated id
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain(PRIVATE_ID);
    expect(logs.toLowerCase()).not.toContain('x-github-token');
    // The error response must not echo the token or the full id either.
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_ID);
  });

  it('scrubs URL query strings and private ids from logged errors', () => {
    const { logger, output } = captureLogs();
    const err = new Error(
      `fetch https://codeload.github.com/o/r/tar?token=SHORTLIVED123 failed for ${PRIVATE_ID}`,
    );
    logger.error({ err }, 'download failed');
    const logs = output();
    expect(logs).toContain('download failed');
    expect(logs).not.toContain('SHORTLIVED123');
    expect(logs).not.toContain(PRIVATE_ID);
  });

  it('censors token-bearing fields if they are ever logged directly', () => {
    const { logger, output } = captureLogs();
    logger.info({ headers: { 'x-github-token': TOKEN, authorization: TOKEN } }, 'oops');
    expect(output()).not.toContain(TOKEN);
  });
});
