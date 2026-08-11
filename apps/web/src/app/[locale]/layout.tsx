import { DirectionProvider, directionAttributes } from '@haul/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation.js';
import type { ReactElement, ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type Locale,
} from '@/i18n/locales.js';
import { messagesFor } from '@/i18n/messages/index.js';
import { MessagesProvider } from '@/i18n/provider.js';
import '../globals.css';

/**
 * ---------------------------------------------------------------------------
 * The root layout
 * ---------------------------------------------------------------------------
 * There is no `app/layout.tsx`. Every page in this product lives under a locale,
 * so the locale segment owns `<html>` — which is the only place `dir` and `lang`
 * can go and still mean anything.
 *
 * **Both the attributes and the provider are required, and neither substitutes
 * for the other.** They answer different questions to different consumers:
 *
 *   - `directionAttributes(locale)` puts `dir` and `lang` on the document.
 *     Logical properties — `ps-4`, `border-s`, `text-start`, every utility this
 *     design system is written in — resolve against the *document's* direction.
 *     Without the attribute the browser was never told which way the text runs,
 *     so a perfectly RTL-authored tree lays out left-to-right.
 *   - `<DirectionProvider>` publishes the locale to React. The handful of
 *     components that genuinely branch — a Money amount picking its CLDR
 *     formatting, a chevron pointing along the reading direction — read it from
 *     context, and a context that nobody set means every one of them silently
 *     falls back to Hebrew regardless of the URL.
 *
 * Ship one and you get an RTL context inside an LTR layout, or an LTR page whose
 * prices are formatted for Hebrew. Both look almost right.
 * ---------------------------------------------------------------------------
 */

/**
 * Runs before React, before hydration, before first paint.
 *
 * `@haul/ui`'s stylesheet describes three theme states — `data-theme="dark"`
 * forces dark, `data-theme="light"` forces light, and an absent attribute
 * follows the system — but nothing in that package sets the attribute, because
 * a design system has no storage and no document. This is the app's half of
 * that contract, and it has to be an inline blocking script: React cannot run
 * early enough. A driver who chose dark and gets one frame of a white page in a
 * truck cab at night has been shown exactly the thing the choice existed to
 * prevent.
 *
 * `system` writes nothing, which is why the absent attribute is the third state
 * rather than a fourth value. `try`/`catch` because `localStorage` throws
 * outright in a partitioned iframe and in Safari's private mode, and a theme
 * preference is not worth taking the page down for.
 */
const THEME_SCRIPT = `(function () {
  try {
    var choice = localStorage.getItem('haul-theme');
    if (choice === 'dark' || choice === 'light') {
      document.documentElement.setAttribute('data-theme', choice);
    }
  } catch (error) {}
})();`;

interface LocaleRouteProps {
  params: Promise<{ locale: string }>;
}

/**
 * Both locales are prerendered. There are two of them and neither depends on a
 * request, so the alternative is rendering Hebrew on demand for a market where
 * Hebrew is every page.
 */
export function generateStaticParams(): Array<{ locale: Locale }> {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleRouteProps): Promise<Metadata> {
  const { locale } = await params;
  // Metadata is generated for the 404 too, and `notFound()` below has not run
  // yet at that point — so an unknown segment gets the default catalog rather
  // than throwing a second, less useful error on top of the first.
  const t = messagesFor(isSupportedLocale(locale) ? locale : DEFAULT_LOCALE);
  return { title: t.documentTitle, description: t.documentDescription };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleRouteProps & { children: ReactNode }): Promise<ReactElement> {
  const { locale } = await params;
  // `generateStaticParams` prerenders the two we serve; the segment is still a
  // free string at runtime, and `/de/quote` is a 404 rather than a Hebrew page
  // served under a German URL.
  if (!isSupportedLocale(locale)) notFound();

  return (
    // The theme script mutates this element before React sees it, which is by
    // definition a difference between the server's HTML and the client's.
    <html {...directionAttributes(locale)} suppressHydrationWarning>
      <body>
        {/* eslint-disable-next-line react/no-danger -- The rule is right about
            markup; this is a string of our own JavaScript that has to execute
            before first paint, and there is no other mechanism that runs
            earlier. It interpolates nothing, so there is no injection surface. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <DirectionProvider locale={locale}>
          <MessagesProvider messages={messagesFor(locale)}>{children}</MessagesProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
