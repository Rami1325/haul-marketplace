'use client';

import { localised, type Locale } from '@haul/types';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { useDirection } from './direction.js';
import { LtrRun } from './input.js';
import { LiveRegion } from './live-region.js';

/**
 * ---------------------------------------------------------------------------
 * Countdown
 * ---------------------------------------------------------------------------
 * The Price Lock timer. HAUL sells one sentence — the number you saw is the
 * number you pay — and this is the component that says how long that sentence
 * remains true. Everything below answers to the fact that it is counting down a
 * commercial promise rather than decorating a screen.
 *
 * **The clock is a prop, and it has to be.** `Date.now()` read during render is
 * a different number on the server than in the browser that hydrates it, so the
 * first paint and the first client render disagree about the remaining time —
 * React discards the mismatched text, and the customer sees the timer flicker
 * to a different figure on a screen whose entire job is to look like a
 * commitment. `now` is therefore what both sides agree on. After mount this
 * component owns its own clock, deliberately: a parent re-rendering for an
 * unrelated reason must not be able to make a running timer jump.
 *
 * **And it goes on counting on that clock rather than the phone's.** Each tick
 * is the time elapsed since mount added to the server's anchor, never a fresh
 * reading of the device's wall clock. A phone that is four minutes slow — the
 * ordinary case, which is why the quote contract carries `secondsRemaining`
 * beside `expiresAt` at all — would otherwise be compared against a server
 * `expiresAt`: the figure starts at 15:00, jumps *up* to 18:59 one second
 * later, and still reads 03:59 in ordinary ink at the moment the server starts
 * refusing the price. The elapsed time between two readings of a wrong clock is
 * right even though neither reading is, which is the whole of the trick.
 * `secondsRemaining` is that same anchor said the way the server says it, for a
 * caller whose only `now` is the device's own.
 *
 * **It announces at thresholds, never on every tick.** A polite region wired to
 * the seconds would speak once a second for the life of the lock, which is not
 * an accessible timer — it is a timer that makes the rest of the screen
 * unusable, and the first thing anyone does about it is turn the region off. So
 * the visible clock carries `role="timer"`, whose implicit live setting is
 * *off*: it is there to be read on demand, which is what a screen reader's own
 * "read current element" is for. The spoken sentences are the ones that change a
 * decision — five minutes, one minute, thirty seconds, ten, gone — and each is
 * announced once, when the remaining time crosses into that band. Mounting
 * inside a band is silent, because nothing has changed yet; announcing "five
 * minutes remaining" to someone who just opened the screen is noise, and noise
 * at the top is what stops the ten-second warning from landing.
 *
 * The duration inside the sentence is formatted rather than written, because
 * Hebrew counts one, two and many differently: CLDR gives שתי דקות for two and
 * 5 דקות for five, and a template that spelled either of them out would be
 * right for the counts it was written for and broken Hebrew for the rest. That
 * is the trap `PriceCard`'s adjustment sentences document at length, met again
 * here. The figure announced is the *threshold* rather than the exact remaining
 * time, because a tick can land at 59 seconds and "59 seconds" is a number
 * nobody chose to say.
 *
 * **Urgency is not carried by motion alone.** Under a minute the figure goes
 * rust and pulses; under `prefers-reduced-motion` the pulse is gone and the
 * colour and weight remain, so the state survives for a user who asked the
 * operating system to stop things moving. Colour is not carrying it alone
 * either — the figure is a number counting down in front of the reader, which is
 * the channel that works in sunlight, in greyscale and for the one man in twelve
 * who cannot separate rust from ink.
 *
 * Expiry drops the figure to `ink-3` rather than shouting louder. A clock at
 * zero has nothing left to hurry anyone toward, and what matters at that point
 * is the sentence the surface puts beside it — `PriceCard` withdraws the amber
 * and states the lapse in words, which is the same decision made one level up.
 * ---------------------------------------------------------------------------
 */

export interface RemainingTime {
  /** Whole seconds left, floored at zero. Never negative — an expired lock is not "−12s". */
  readonly totalSeconds: number;
  /** Total minutes, not minutes-within-an-hour: a two-hour hold reads 120:00. */
  readonly minutes: number;
  readonly seconds: number;
  readonly expired: boolean;
}

/**
 * Rounded *up*, so a lock with 400ms left still reads 00:01. Rounding down would
 * show 00:00 beside a price that is still honourable, which is the one direction
 * this component is not allowed to be wrong in.
 */
export function remainingTime(expiresAt: Date, now: Date): RemainingTime {
  const milliseconds = expiresAt.getTime() - now.getTime();
  const totalSeconds = milliseconds <= 0 ? 0 : Math.ceil(milliseconds / 1000);
  return {
    totalSeconds,
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
    expired: milliseconds <= 0,
  };
}

/** `04:07`. Latin digits, which is what Hebrew uses. */
export function formatClock(remaining: RemainingTime): string {
  const minutes = String(remaining.minutes).padStart(2, '0');
  const seconds = String(remaining.seconds).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * The bands worth interrupting someone for, in seconds remaining. Five minutes
 * is enough time to finish reading the breakdown; one minute is enough to press
 * the button; thirty and ten are the last chances to be told; zero is the fact.
 */
export const COUNTDOWN_THRESHOLDS_SECONDS: readonly number[] = [300, 60, 30, 10, 0];

/**
 * Which band a remaining time has reached: the smallest threshold still at or
 * above it, or null while the clock is above every threshold.
 *
 * Exported because it is the whole announcement policy, and a policy is worth
 * testing directly rather than through a component and a fake clock.
 */
export function announcedThreshold(seconds: number, thresholds: readonly number[]): number | null {
  let reached: number | null = null;
  for (const threshold of thresholds) {
    if (threshold < seconds) continue;
    if (reached === null || threshold < reached) reached = threshold;
  }
  return reached;
}

/** A sentence built around an already-formatted duration. */
export type CountdownPhrase = (duration: string) => string;

interface LocalisedPhrase {
  readonly he: CountdownPhrase;
  readonly en: CountdownPhrase;
}

/**
 * The two sentences this component authors, as a table so a test can walk the
 * whole vocabulary rather than sample it. The duration inside them is never
 * written — see the header.
 *
 * **"עוד", not "נותרו", and that is grammar rather than register.** A Hebrew
 * verb agrees with its subject in gender and number, so "נותרו" is wrong for one
 * minute (נותרה) and the correct form depends on a unit this function does not
 * choose — דקה is feminine, רגע is masculine. "עוד" does not inflect at all, so
 * it is right for every count and unit the formatter can produce. A sentence
 * that cannot be conjugated wrongly is worth more here than one that reads a
 * shade more formally when it happens to be conjugated right.
 */
export const COUNTDOWN_COPY: Readonly<Record<'remaining' | 'expired', LocalisedPhrase>> = {
  remaining: {
    he: (duration) => `עוד ${duration}`,
    en: (duration) => `${duration} left`,
  },
  // The duration is ignored rather than absent, so the table has one shape and a
  // test can walk the whole vocabulary instead of special-casing an entry.
  expired: {
    he: () => 'הזמן נגמר',
    en: () => 'Time is up',
  },
};

export function countdownAnnouncement(seconds: number, locale: Locale): string {
  if (seconds <= 0) return localised(locale, COUNTDOWN_COPY.expired)('');

  // `Intl.NumberFormat` with a unit rather than `RelativeTimeFormat`: what is
  // being stated is a length of time, not a point relative to now, and CLDR's
  // Hebrew relative phrasing renders one minute as "בעוד דקה (1)" — a
  // parenthesised numeral that is correct data and an odd thing to say out loud.
  const inMinutes = seconds >= 60;
  const duration = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: inMinutes ? 'minute' : 'second',
    unitDisplay: 'long',
  }).format(inMinutes ? Math.round(seconds / 60) : seconds);

  return localised(locale, COUNTDOWN_COPY.remaining)(duration);
}

export interface CountdownProps {
  /** When the promise lapses. */
  expiresAt: Date;
  /**
   * The clock, injected. It is what the server render and the first client
   * render agree on; after mount this component advances it itself.
   */
  now: Date;
  /**
   * The server's own count of the seconds left — `QuoteView.secondsRemaining`.
   * When given it anchors the clock instead of `now`, which is what a caller
   * with nothing but the device's idea of the time should hand over.
   */
  secondsRemaining?: number;
  /** What is running out. Required — a bare figure is a number with no noun. */
  label: ReactNode;
  /** Off by default: on the Price Card the surface around it already says what it is. */
  showLabel?: boolean;
  /** Below this many seconds the figure goes rust and pulses. */
  urgentBelowSeconds?: number;
  /** Seconds remaining at which to announce. Fewer is usually better. */
  announceAt?: readonly number[];
  /** Overrides the spoken sentence. The app's copy layer owns its own words. */
  formatAnnouncement?: (seconds: number, locale: Locale) => string;
  /** Fired once, when the clock reaches zero. */
  onExpire?: () => void;
  /** How often the clock is re-read. A second, unless a surface needs otherwise. */
  intervalMs?: number;
  /** Defaults to the surrounding `DirectionProvider`, i.e. Hebrew. */
  locale?: Locale;
  id?: string;
  className?: string;
}

export function Countdown({
  expiresAt,
  now,
  secondsRemaining,
  label,
  showLabel = false,
  urgentBelowSeconds = 60,
  announceAt = COUNTDOWN_THRESHOLDS_SECONDS,
  formatAnnouncement = countdownAnnouncement,
  onExpire,
  intervalMs = 1000,
  locale,
  id,
  className,
}: CountdownProps) {
  const { locale: contextLocale } = useDirection();
  const active = locale ?? contextLocale;

  const generatedId = useId();
  const timerId = id ?? `${generatedId}-countdown`;
  const labelId = `${timerId}-label`;

  // Fixed at mount: where the server said the time was, and what the device
  // read at that same instant. Everything after this is a delta between two
  // device readings, so the phone's offset cancels out of every one of them.
  const [anchor] = useState(() => ({
    serverMs:
      secondsRemaining === undefined
        ? now.getTime()
        : expiresAt.getTime() - secondsRemaining * 1000,
    deviceMs: Date.now(),
  }));
  const [elapsedMs, setElapsedMs] = useState(0);

  const remaining = remainingTime(expiresAt, new Date(anchor.serverMs + elapsedMs));
  const done = remaining.expired;

  // The interval is torn down rather than left running once the clock is spent:
  // a booking flow can leave a lapsed Price Card mounted behind a sheet for a
  // long time, and a timer that keeps waking a phone up to render the same
  // 00:00 is a battery cost with nothing on the other side of it.
  useEffect(() => {
    if (done) return;
    const tick = () => setElapsedMs(Date.now() - anchor.deviceMs);
    // Caught up before the interval restarts, because it is the teardown above
    // that leaves the reading stale: a re-quote handed to a mounted timer would
    // otherwise spend its first second showing however long the lapse lasted.
    tick();
    const handle = setInterval(tick, intervalMs);
    return () => clearInterval(handle);
  }, [anchor, done, intervalMs]);

  // Latched per lock rather than for the life of the component. A parent that
  // hands a mounted timer a fresh `expiresAt` has made a second promise, and
  // the second lapse is exactly as much news to the booking flow as the first —
  // `onExpire` is the only thing that tells it to stop offering the price.
  const firedFor = useRef<number | null>(null);
  const expiresAtMs = expiresAt.getTime();
  useEffect(() => {
    if (!done || firedFor.current === expiresAtMs) return;
    firedFor.current = expiresAtMs;
    onExpire?.();
  }, [done, expiresAtMs, onExpire]);

  const threshold = announcedThreshold(remaining.totalSeconds, announceAt);
  // The band the first render landed in. Mounting inside one is silent: nothing
  // has changed yet, and "five minutes left" said to someone who has just opened
  // the screen is the noise that stops the ten-second warning from landing.
  //
  // Everything after that is derived here rather than pushed into state from an
  // effect, and the derivation is the announcement policy itself. The region's
  // text changes exactly when the band does — which is exactly when a screen
  // reader should speak — and is byte-identical on every tick in between, which
  // is what keeps it silent for the other 895 seconds of a lock.
  const [bandAtMount] = useState<number | null>(threshold);
  const announcement =
    threshold === null || threshold === bandAtMount ? '' : formatAnnouncement(threshold, active);

  const urgent = !done && remaining.totalSeconds <= urgentBelowSeconds;
  const tone = done ? 'text-ink-3' : urgent ? 'text-rust' : 'text-ink';

  return (
    <div
      className={cn('flex items-baseline gap-2', className)}
      data-expired={done ? '' : undefined}
      data-urgent={urgent ? '' : undefined}
    >
      <span id={labelId} className={showLabel ? 'font-body text-ink-2 text-start' : 'sr-only'}>
        {label}
      </span>

      <span
        id={timerId}
        role="timer"
        aria-labelledby={labelId}
        className={cn(
          'text-step-1 font-bold',
          tone,
          // Motion is the second channel, never the only one — the colour and
          // the falling figure both survive a user who asked for stillness.
          urgent ? 'animate-pulse motion-reduce:animate-none' : '',
        )}
      >
        <LtrRun>{formatClock(remaining)}</LtrRun>
      </span>

      <LiveRegion message={announcement} />
    </div>
  );
}
