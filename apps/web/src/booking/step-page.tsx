import type { DraftStep } from '@haul/contracts';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { isSupportedLocale } from '@/i18n/locales.js';
import { messagesFor } from '@/i18n/messages/index.js';
import { requireStep } from '@/server/booking.js';

/**
 * ---------------------------------------------------------------------------
 * The shape every booking step shares
 * ---------------------------------------------------------------------------
 * Eight routes, one guard. `page.tsx` under each step is three lines naming its
 * step, and everything that must happen identically on all of them happens
 * here: the locale is checked, the draft is read, and a customer who has not
 * answered enough to be on this screen is redirected to the one they belong on
 * before anything renders.
 *
 * A factory rather than a component with a `step` prop, because a route's
 * default export is called by the framework with route props only — there is
 * nowhere to pass the step in. Binding it at module scope is also what makes
 * the step a static fact about the file: `export default stepPage(Items)` in
 * `book/items/page.tsx` cannot disagree with its own URL the way a value read
 * from `params` could.
 *
 * **The body is deliberately empty in this commit.** The plumbing underneath —
 * the session cookie, the draft row, the guard — is what needed proving, and it
 * is proven by these pages existing and redirecting correctly. Each step's own
 * commit fills in its screen; none of them has to invent a route, a guard or a
 * heading first.
 * ---------------------------------------------------------------------------
 */

interface StepRouteProps {
  params: Promise<{ locale: string }>;
}

export function stepPage(step: DraftStep) {
  return async function StepPage({ params }: StepRouteProps): Promise<ReactElement> {
    const { locale } = await params;
    // The layout above runs the same check and this one is not redundant: a
    // layout cannot stop its own page from rendering, so without it the guard
    // below would run against an unsupported locale on the way to a 404.
    if (!isSupportedLocale(locale)) notFound();

    // Throws a redirect when this step is further along than the draft is.
    await requireStep(locale, step);

    const t = messagesFor(locale);

    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
        <h1 className="font-display text-step-2 font-bold tracking-tight text-ink">
          {t.bookingSteps[step]}
        </h1>
      </main>
    );
  };
}
