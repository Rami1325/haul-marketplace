import { NextResponse, type NextRequest } from 'next/server.js';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  localeFromAcceptLanguage,
  type Locale,
} from '@/i18n/locales.js';

/**
 * ---------------------------------------------------------------------------
 * Locale negotiation
 * ---------------------------------------------------------------------------
 * **This file is `proxy.ts`, not `middleware.ts`, and the name is checked
 * rather than assumed.** Next 16 renamed the convention: `dist/lib/constants.js`
 * declares both `MIDDLEWARE_FILENAME = 'middleware'` and
 * `PROXY_FILENAME = 'proxy'`, and the build accepts either at the project root
 * or under `src/`. They are not interchangeable in one respect —
 * `dist/build/templates/middleware.js` picks the handler by filename, looking
 * for an export named `proxy` in a `proxy` file and `middleware` in a
 * `middleware` file, falling back to the default export in both cases and
 * throwing E394 when neither is a function. `experimental.middlewarePrefetch`
 * and `experimental.middlewareClientMaxBodySize` are deprecated in 16.3 in
 * favour of their `proxy*` spellings, which is the framework saying which name
 * is the current one. So: `proxy.ts`, exporting `proxy`.
 *
 * **Everything here runs on every navigation, so nothing here touches a
 * database, a rate card or the pricing engine.** Three cheap reads in a fixed
 * order, and the order is the whole design:
 *
 *   1. **The cookie**, because a customer who has chosen a language has already
 *      answered this question and the answer must outrank their browser.
 *   2. **`Accept-Language`**, quality values honoured — the only signal that
 *      separates a browser configured for Hebrew-then-English from one
 *      configured the other way round, since both send both tags.
 *   3. **`DEFAULT_LOCALE`**, which is Hebrew. Not "the first tag we recognise",
 *      not English: a header naming only Russian gets the product's default
 *      rather than a guess dressed up as a negotiation.
 *
 * A request that already carries a supported prefix is left alone. Everything
 * else is redirected — `/quote` becomes `/he/quote` — rather than rewritten,
 * because the locale has to end up in the address bar. A rewrite would serve
 * Hebrew at a URL that says nothing about language, and the first thing anyone
 * does with a booking link is send it to the person they are moving with.
 * ---------------------------------------------------------------------------
 */

/**
 * Skips Next's own asset routes and anything that looks like a file.
 *
 * `.*\..*` is doing the work: a request for `/favicon.ico` or `/og.png` has no
 * business being redirected into a locale segment, and matching on a dot is
 * cheaper and less brittle than listing the public directory here.
 */
export const config = {
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};

function negotiate(request: NextRequest): Locale {
  const chosen = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isSupportedLocale(chosen)) return chosen;
  return localeFromAcceptLanguage(request.headers.get('accept-language')) ?? DEFAULT_LOCALE;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const [, first] = pathname.split('/');

  if (isSupportedLocale(first)) return NextResponse.next();

  const locale = negotiate(request);
  const url = request.nextUrl.clone();
  // `/` must not become `/he/` — a trailing slash on the root is a second URL
  // for the same page, which Next then redirects again.
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}
