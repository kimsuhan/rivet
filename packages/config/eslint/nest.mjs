import globals from 'globals';

import { baseConfig } from './base.mjs';

export const nestConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: globals.jest,
    },
  },
];
