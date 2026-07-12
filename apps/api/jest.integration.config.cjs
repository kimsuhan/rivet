const baseConfig = require('./jest.config.cjs');

module.exports = {
  ...baseConfig,
  setupFiles: ['<rootDir>/test/setup-test-env.ts'],
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
};
