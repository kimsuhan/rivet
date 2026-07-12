import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { webEnvironment } from './lib/environment';

const nextConfig: NextConfig = {
  transpilePackages: ['@rivet/api-client'],
  async headers() {
    const logMetadataHeaders = [
      { key: 'X-Rivet-Environment', value: webEnvironment.NODE_ENV },
      { key: 'X-Rivet-Release-Id', value: webEnvironment.RELEASE_ID },
    ];

    const sensitiveRoutes = [
      '/verify-email',
      '/reset-password',
      '/invite',
      '/ko/verify-email',
      '/ko/reset-password',
      '/ko/invite',
    ];

    return [
      { source: '/:path*', headers: logMetadataHeaders },
      ...sensitiveRoutes.map((source) => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      })),
    ];
  },
  async rewrites() {
    if (webEnvironment.NODE_ENV === 'production' && process.env.PLAYWRIGHT_API_PROXY !== 'true') {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: `${webEnvironment.API_INTERNAL_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
