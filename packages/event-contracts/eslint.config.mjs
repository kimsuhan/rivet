import globals from 'globals';

import { baseConfig } from '@rivet/config/eslint/base';

export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['test/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
