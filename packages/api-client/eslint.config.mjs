import globals from 'globals';

import { baseConfig } from '@rivet/config/eslint/base';

export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
