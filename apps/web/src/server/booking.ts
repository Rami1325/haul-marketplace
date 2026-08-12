import { DEFAULT_CITY, cityById, type CityConfig } from '@haul/config';
import {
  canEnterStep,
  draftProblems,
  newBookingDraft,
  resumeStep,
  type BookingDraft,
  type DraftProblem,
  type DraftStep,
} from '@haul/contracts';
import { redirect } from 'next/navigation.js';
import { stepPath } from '@/booking/paths.js';
import type { Locale } from '@/i18n/locales.js';
import { currentDraft } from './drafts.js';

/**
 * ---------------------------------------------------------------------------
 * Where this customer is in the flow, and whether they may be here
 * ---------------------------------------------------------------------------
 * The guard every step page runs before it renders anything.
 *
 * **It does not decide what a finished step looks like.** `draftProblems` — the
 * same function the server refuses to price with — says what is still missing,
 * and `@haul/contracts` says which screen owns each answer. This assembles the
 * arguments and acts on the verdict. A guard with its own opinion about
 * completeness is a guard that will one day wave a draft through to a price
 * screen that then refuses to produce a price, or bounce a customer back to a
 * form they have already filled in; both are the same bug, which is two
 * definitions of "done".
 *
 * **Gating is forward-only.** Going back is always allowed, because in an
 * eleven-URL flow the back button *is* the step navigator and an earlier screen
 * shows nothing the customer has not already told us. Forward past the first
 * unanswered question is refused, because those screens cannot render honestly:
 * a price with no date behind it is not a price.
 * ---------------------------------------------------------------------------
 */

export interface BookingPosition {
  /**
   * The stored draft, or an empty one for a customer who has answered nothing.
   *
   * The empty draft is built in memory and never written. A page render that
   * created a row would create one on every prefetch and every refresh, and the
   * table would fill with drafts belonging to people who hovered over a link.
   */
  readonly draft: BookingDraft;
  /** `drf_…`, or null when nothing has been answered and no row exists yet. */
  readonly draftId: string | null;
  readonly city: CityConfig;
  readonly problems: readonly DraftProblem[];
  /** The furthest step this draft may be on. */
  readonly resume: DraftStep;
}

/**
 * Which city's card and calendar this draft is measured against.
 *
 * A stored `cityId` that no longer resolves — a city withdrawn from the config,
 * a draft replayed somewhere it does not belong — falls back to the default
 * rather than throwing, and the fallback is what *produces* the
 * `city_mismatch` problem downstream. The customer gets a flow that restarts
 * cleanly instead of a 500.
 */
function cityFor(cityId: string | null | undefined): CityConfig {
  if (cityId === null || cityId === undefined) return DEFAULT_CITY;
  return cityById(cityId) ?? DEFAULT_CITY;
}

export async function bookingPosition(
  locale: Locale,
  now: Date = new Date(),
): Promise<BookingPosition> {
  const record = await currentDraft(now);
  const draft = record?.draft ?? newBookingDraft(DEFAULT_CITY.id, locale);
  const city = cityFor(record?.cityId);

  // `now` is passed rather than read inside, so this reading of the draft and
  // the price the server later locks are made against the same instant. A `now`
  // booking priced a second apart can cross a Shabbat boundary, and that is a
  // different rate card row.
  const problems = draftProblems(draft, city, city.rateCard, { now });

  return {
    draft,
    draftId: record?.id ?? null,
    city,
    problems,
    // No `hasQuote` yet: `createQuote` and the `quotes` row it writes arrive
    // with step 07. Until then a complete draft resumes to the price screen,
    // which is exactly where a customer who has answered everything belongs.
    resume: resumeStep(problems),
  };
}

/**
 * Render this step, or redirect to the one the customer actually belongs on.
 *
 * `redirect` throws, so a caller that ignores the return value still cannot
 * render a step it was not allowed to reach.
 */
export async function requireStep(locale: Locale, step: DraftStep): Promise<BookingPosition> {
  const position = await bookingPosition(locale);
  if (!canEnterStep(step, position.problems)) redirect(stepPath(locale, position.resume));
  return position;
}
