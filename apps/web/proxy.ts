import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  // Next 16 can pass the internal locale rewrite through Proxy again. The locale
  // header proves next-intl already normalized this request, so do not canonicalize it twice.
  if (request.headers.has('x-next-intl-locale')) {
    return NextResponse.next();
  }

  return handleI18nRouting(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
