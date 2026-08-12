import { notFound, redirect } from 'next/navigation.js';
import { stepPath } from '@/booking/paths.js';
import { isSupportedLocale } from '@/i18n/locales.js';
import { bookingPosition } from '@/server/booking.js';

/**
 * ---------------------------------------------------------------------------
 * `/book` — the door back in
 * ---------------------------------------------------------------------------
 * Never renders. It reads the draft this browser is holding and sends the
 * customer to the step they left off on, which makes it the one URL worth
 * putting on a "carry on where you left off" email, a push notification or the
 * home page's own button. Every other booking URL names a specific screen and
 * would be wrong the moment the customer answers something.
 *
 * A customer holding nothing gets step 01, by the same route as everyone else:
 * `bookingPosition` builds an empty draft in memory when there is no row, and
 * an empty draft's first unanswered question is on the first screen. There is
 * no branch here for "new" versus "returning", because there is no difference —
 * which is what stops the two paths from drifting apart.
 * ---------------------------------------------------------------------------
 */

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function BookPage({ params }: PageProps): Promise<never> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  const { resume } = await bookingPosition(locale);
  redirect(stepPath(locale, resume));
}
