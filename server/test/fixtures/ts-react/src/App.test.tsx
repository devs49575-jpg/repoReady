import { it } from 'vitest';

// process.env.TEST_ONLY_VAR must not be reported
it('works', () => {
  void process.env.TEST_ONLY_VAR;
});
