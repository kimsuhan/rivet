import { nestConfig } from '@rivet/config/eslint/nest';

export default [
  ...nestConfig,
  {
    files: ['*.config.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
