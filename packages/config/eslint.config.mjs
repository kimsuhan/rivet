import globals from 'globals';

import { baseConfig } from './eslint/base.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
