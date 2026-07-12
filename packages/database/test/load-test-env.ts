import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({
  path: resolve(process.cwd(), '../../.env.test.local'),
  override: true,
  quiet: true,
});
