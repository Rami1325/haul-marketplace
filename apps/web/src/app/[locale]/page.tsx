import { agorot } from '@haul/types';
import { Button, Card, Money, Stack } from '@haul/ui';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { bookingEntryPath } from '@/booking/paths.js';
import { isSupportedLocale } from '@/i18n/locales.js';
import { messagesFor } from '@/i18n/messages/index.js';

/**
 * ---------------------------------------------------------------------------
 * The one page in this commit
 * ---------------------------------------------------------------------------
 * Not a landing page and not a demo of the component library. It exists to
 * answer one question a test cannot: does opening `localhost:3000` show the
 * actual brand — Guide Green, Heebo digits, a shekel sign that is not a fallback
 * glyph, and a layout that runs right to left because the document says so?
 *
 * Every failure mode this commit is built to prevent is visible here and only
 * here. A missing `@source` glob leaves the Button and the Card with full class
 * attributes and no CSS. A Latin-only font subset renders ₪ in a system face
 * beside Heebo digits. A missing `dir` on `<html>` mirrors the whole column.
 * None of those throw.
 *
 * The figure is real. ₪1,890.00 is what the calibrated engine quotes for a
 * דירת 2 חדרים in Tel Aviv against a market typical of ₪1,900 — a number this
 * repo has already defended, rather than a placeholder that would have to be
 * remembered and removed.
 * ---------------------------------------------------------------------------
 */

/** In agorot, because money in this codebase is never a float. */
const EXAMPLE_QUOTE = agorot(189_000);

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  const t = messagesFor(locale);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-8 p-6">
      <Stack gap="3">
        <h1 className="font-display text-step-3 font-black tracking-tight text-ink">HAUL</h1>
        <p className="text-step-1 text-ink-2">{t.tagline}</p>
      </Stack>

      <Card elevation="raised">
        <Stack gap="2">
          <span className="text-step-0 text-ink-2">{t.exampleQuoteCaption}</span>
          <Money amount={EXAMPLE_QUOTE} size="total" />
          {/* No `uppercase`: Hebrew has no case, so a rule that does nothing in
              the primary locale and shouts in the secondary is a Latin-first
              habit rather than a design decision. Weight carries it instead. */}
          <span className="font-display text-step-0 font-bold text-route">{t.priceLockLabel}</span>
          <p className="text-step-0 text-ink-2">{t.priceLockNote}</p>
        </Stack>
      </Card>

      {/* `/book` rather than `/book/items`: it reads the draft this browser is
          holding and routes onward, so the same button is "start" for a new
          customer and "carry on" for one coming back — with no branch here that
          could disagree with the one in `bookingPosition`.

          A plain anchor, not `<Link>`. This is the entry to a flow rather than a
          page inside one: the target renders nothing and redirects, so there is
          no payload a prefetch could usefully warm, and prefetching on hover
          would run a cookie read and a database query for every customer who
          moved a mouse across the button. */}
      <Button as="a" href={bookingEntryPath(locale)} size="lg">
        {t.startBooking}
      </Button>
    </main>
  );
}
