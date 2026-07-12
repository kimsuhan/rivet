import globals from 'globals';

import { baseConfig } from '@rivet/config/eslint/base';

export default [
  ...baseConfig,
  {
    ignores: ['apps/**', 'packages/**'],
  },
  {
    files: ['*.{js,mjs,cjs,ts}', 'scripts/**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
