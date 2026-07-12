import { defineConfig } from 'orval';

export default defineConfig({
  rivet: {
    input: {
      target: '../../apps/api/openapi/openapi.json',
    },
    output: {
      clean: true,
      client: 'react-query',
      httpClient: 'fetch',
      mode: 'single',
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          name: 'rivetFetch',
          path: './src/fetcher.ts',
        },
        query: {
          signal: true,
        },
      },
      schemas: 'src/generated/models',
      target: 'src/generated/rivet.ts',
    },
  },
});
