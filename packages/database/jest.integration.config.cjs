const baseConfig = require('./jest.config.cjs');

module.exports = {
  ...baseConfig,
  setupFiles: ['<rootDir>/test/load-test-env.ts'],
  testRegex: 'test/.*\\.integration-spec\\.ts$',
};
