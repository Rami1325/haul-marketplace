import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTDOWN_COPY,
  COUNTDOWN_THRESHOLDS_SECONDS,
  Countdown,
  announcedThreshold,
  countdownAnnouncement,
  formatClock,
  remainingTime,
} from '../components/countdown.js';
import { DirectionProvider } from '../components/direction.js';
import { compilesToARule, cssFor } from './helpers/stylesheet.js';

/**
 * The Price Lock timer counts down a commercial promise, so the assertions are
 * about the two ways it could break that promise: showing a figure the server
 * and the browser disagree about, and either talking over the customer for
 * fifteen straight minutes or never telling them the price is about to go.
 *
 * The arithmetic is tested on its own first, without a clock or a DOM, because
 * that is the part a fake timer would obscure rather than exercise.
 */

/** Any Hebrew letter. Used to prove an English surface says none of them. */
const HEBREW = /[֐-׿]/;

const LOCK_MS = 15 * 60 * 1000;

function at(msFromEpoch: number): Date {
  return new Date(msFromEpoch);
}

describe('remainingTime — the arithmetic, on its own', () => {
  it('counts whole seconds down to zero', () => {
    const expires = at(LOCK_MS);
    expect(remainingTime(expires, at(0)).totalSeconds).toBe(900);
    expect(remainingTime(expires, at(LOCK_MS - 1000)).totalSeconds).toBe(1);
    expect(remainingTime(expires, at(LOCK_MS)).totalSeconds).toBe(0);
  });

  it('never goes negative, because an expired lock is not "minus twelve seconds"', () => {
    const remaining = remainingTime(at(0), at(60_000));
    expect(remaining.totalSeconds).toBe(0);
    expect(remaining.minutes).toBe(0);
    expect(remaining.seconds).toBe(0);
    expect(remaining.expired).toBe(true);
  });

  it('rounds up, so a price with 400ms left still reads as having a second', () => {
    // The one direction this component may not be wrong in: showing 00:00 beside
    // a price that is still honourable.
    const remaining = remainingTime(at(1400), at(1000));
    expect(remaining.totalSeconds).toBe(1);
    expect(remaining.expired).toBe(false);
  });

  it('expires exactly at the boundary, not a tick after it', () => {
    expect(remainingTime(at(1000), at(1000)).expired).toBe(true);
    expect(remainingTime(at(1001), at(1000)).expired).toBe(false);
  });

  it('splits into total minutes rather than minutes within an hour', () => {
    // A two-hour hold reads 120:00. Wrapping at sixty would show 00:00 with two
    // hours left on it.
    const remaining = remainingTime(at(2 * 60 * 60 * 1000), at(0));
    expect(remaining.minutes).toBe(120);
    expect(remaining.seconds).toBe(0);
  });

  it('formats a padded clock', () => {
    expect(formatClock(remainingTime(at(LOCK_MS), at(0)))).toBe('15:00');
    expect(formatClock(remainingTime(at(67_000), at(0)))).toBe('01:07');
    expect(formatClock(remainingTime(at(0), at(0)))).toBe('00:00');
  });
});

describe('announcedThreshold — the announcement policy, on its own', () => {
  const thresholds = COUNTDOWN_THRESHOLDS_SECONDS;

  it('says nothing while the clock is above every threshold', () => {
    expect(announcedThreshold(901, thresholds)).toBeNull();
    expect(announcedThreshold(301, thresholds)).toBe(null);
  });

  it('reports the band a time has fallen into, not the largest band it is under', () => {
    expect(announcedThreshold(300, thresholds)).toBe(300);
    expect(announcedThreshold(290, thresholds)).toBe(300);
    expect(announcedThreshold(61, thresholds)).toBe(300);
    expect(announcedThreshold(60, thresholds)).toBe(60);
    expect(announcedThreshold(31, thresholds)).toBe(60);
    expect(announcedThreshold(30, thresholds)).toBe(30);
    expect(announcedThreshold(10, thresholds)).toBe(10);
    expect(announcedThreshold(0, thresholds)).toBe(0);
  });

  it('changes exactly once per band, so each sentence is said once', () => {
    const bands = new Set<number | null>();
    let changes = 0;
    let previous: number | null = announcedThreshold(900, thresholds);
    for (let seconds = 900; seconds >= 0; seconds -= 1) {
      const band = announcedThreshold(seconds, thresholds);
      bands.add(band);
      if (band !== previous) changes += 1;
      previous = band;
    }
    expect(changes).toBe(thresholds.length);
    expect(bands.size).toBe(thresholds.length + 1);
  });

  it('accepts a caller’s own bands', () => {
    expect(announcedThreshold(45, [120, 45])).toBe(45);
    expect(announcedThreshold(46, [120, 45])).toBe(120);
    expect(announcedThreshold(5, [])).toBeNull();
  });
});

describe('countdownAnnouncement — the duration is formatted, never written', () => {
  it('counts one, two and many the way Hebrew counts them', () => {
    // The dual is not optional politeness: "2 דקות" reads as machine
    // translation where שתי דקות reads as a person wrote it, and no template
    // gets both that and "5 דקות" right.
    expect(countdownAnnouncement(120, 'he')).toContain('שתי דקות');
    expect(countdownAnnouncement(300, 'he')).toContain('5 דקות');
    expect(countdownAnnouncement(30, 'he')).toContain('30 שניות');
  });

  it('switches from minutes to seconds under a minute', () => {
    expect(countdownAnnouncement(300, 'en')).toMatch(/5 minutes/);
    expect(countdownAnnouncement(60, 'en')).toMatch(/1 minute/);
    expect(countdownAnnouncement(30, 'en')).toMatch(/30 seconds/);
  });

  it('says both of the sentences it authors in both languages', () => {
    for (const [name, phrase] of Object.entries(COUNTDOWN_COPY)) {
      // A Latin argument, so what is measured is the sentence rather than what
      // was substituted into it.
      expect(phrase.he('X'), name).toMatch(HEBREW);
      expect(phrase.en('X'), name).not.toMatch(HEBREW);
    }
  });

  it('uses a Hebrew form that cannot be conjugated wrongly', () => {
    // "נותרו" would have to agree in gender and number with a unit this
    // function does not choose. "עוד" does not inflect at all.
    expect(countdownAnnouncement(60, 'he')).toContain('עוד');
    expect(countdownAnnouncement(120, 'he')).toContain('עוד');
  });

  it('states the lapse rather than a duration once the clock is spent', () => {
    expect(countdownAnnouncement(0, 'he')).toBe(COUNTDOWN_COPY.expired.he(''));
    expect(countdownAnnouncement(-5, 'en')).toBe(COUNTDOWN_COPY.expired.en(''));
  });

  it('announces no Hebrew at all on an English surface', () => {
    for (const seconds of [300, 120, 60, 30, 10, 0]) {
      expect(countdownAnnouncement(seconds, 'en'), String(seconds)).not.toMatch(HEBREW);
    }
  });
});

describe('Countdown — the clock is a prop', () => {
  afterEach(cleanup);

  it('renders the figure it was handed, not the one the machine happens to hold', () => {
    // `Date.now()` read during render is a different number on the server than
    // in the browser that hydrates it, and the customer watches the timer
    // flicker on the screen whose job is to look like a commitment.
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);
    expect(screen.getByRole('timer')).toHaveTextContent('15:00');
  });

  it('renders the same figure twice for the same inputs', () => {
    const { container: first } = render(
      <Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(90_000)} />,
    );
    const before = first.textContent;
    cleanup();

    const { container: second } = render(
      <Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(90_000)} />,
    );
    expect(second.textContent).toBe(before);
  });

  it('names the figure, so a bare number is never announced alone', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);
    expect(screen.getByRole('timer', { name: 'נעילת מחיר' })).toBeInTheDocument();
    expect(screen.getByText('נעילת מחיר')).toHaveClass('sr-only');
  });

  it('shows the label when a surface asks for it', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} showLabel />);
    expect(screen.getByText('נעילת מחיר')).not.toHaveClass('sr-only');
  });
});

describe('Countdown — running', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('ticks down once a second', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);
    expect(screen.getByRole('timer')).toHaveTextContent('15:00');

    advance(1000);
    expect(screen.getByRole('timer')).toHaveTextContent('14:59');

    advance(59_000);
    expect(screen.getByRole('timer')).toHaveTextContent('14:00');
  });

  it('stops at zero rather than counting into the negative', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(3000)} now={at(0)} />);
    advance(10_000);
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
  });

  it('calls onExpire once, and only once', () => {
    const onExpire = vi.fn();
    render(<Countdown label="נעילת מחיר" expiresAt={at(2000)} now={at(0)} onExpire={onExpire} />);
    expect(onExpire).not.toHaveBeenCalled();

    advance(3000);
    expect(onExpire).toHaveBeenCalledTimes(1);

    advance(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('calls onExpire for a lock that was already spent when it mounted', () => {
    const onExpire = vi.fn();
    render(<Countdown label="נעילת מחיר" expiresAt={at(0)} now={at(1000)} onExpire={onExpire} />);
    act(() => undefined);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('calls onExpire again for the second lock, because a re-quote is a second promise', () => {
    // `onExpire` is the only signal the booking flow gets that the price promise
    // has lapsed. A latch that never reopens leaves a spent price on screen
    // under a live "Book this move" button — the visible clock restarts, and
    // nothing tells anyone when it runs out.
    const onExpire = vi.fn();
    const { rerender } = render(
      <Countdown label="נעילת מחיר" expiresAt={at(3000)} now={at(0)} onExpire={onExpire} />,
    );

    advance(4000);
    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender(
      <Countdown label="נעילת מחיר" expiresAt={at(28_000)} now={at(0)} onExpire={onExpire} />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:24');

    advance(30_000);
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});

describe('Countdown — it counts on the server’s clock, not the phone’s', () => {
  /**
   * The server locks a price 10:00:00Z → 10:15:00Z and the phone reading it is
   * four minutes slow, which `QuoteViewSchema.secondsRemaining` calls the
   * ordinary case rather than a pathological one. Re-reading the device's wall
   * clock on every tick makes the first paint right and every tick after it
   * wrong: the figure jumps *up* to 18:59 a second in, and at the real expiry
   * the Price Lock screen still reads 03:59 in ordinary ink.
   */
  const SERVER_NOW = Date.UTC(2026, 0, 1, 10, 0, 0);
  const SERVER_EXPIRY = SERVER_NOW + LOCK_MS;
  const PHONE_IS_SLOW_BY = 4 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER_NOW - PHONE_IS_SLOW_BY);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('takes a second off the figure it was handed, rather than jumping to the device’s', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(SERVER_EXPIRY)} now={at(SERVER_NOW)} />);
    expect(screen.getByRole('timer')).toHaveTextContent('15:00');

    advance(1000);
    expect(screen.getByRole('timer')).toHaveTextContent('14:59');

    advance(59_000);
    expect(screen.getByRole('timer')).toHaveTextContent('14:00');
  });

  it('expires when the server’s lock expires, and says so', () => {
    const onExpire = vi.fn();
    const { container } = render(
      <Countdown
        label="נעילת מחיר"
        expiresAt={at(SERVER_EXPIRY)}
        now={at(SERVER_NOW)}
        onExpire={onExpire}
      />,
    );

    advance(LOCK_MS);
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
    expect(container.firstElementChild).toHaveAttribute('data-expired');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('prefers the server’s own count of the seconds when it is handed one', () => {
    // The contract carries `secondsRemaining` beside `expiresAt` precisely so a
    // client that only has the device's idea of now still starts at the right
    // number. Here `now` *is* the slow phone, and the figure is still right.
    render(
      <Countdown
        label="נעילת מחיר"
        expiresAt={at(SERVER_EXPIRY)}
        now={at(Date.now())}
        secondsRemaining={LOCK_MS / 1000}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('15:00');

    advance(1000);
    expect(screen.getByRole('timer')).toHaveTextContent('14:59');
  });
});

describe('Countdown — it announces at thresholds, never on every tick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  function announcement(): string {
    return document.querySelector('[data-live-region="polite"]')?.textContent ?? '';
  }

  it('leaves the visible clock outside the live region entirely', () => {
    // `role="timer"` has an implicit live setting of *off*. A polite region
    // wired to the seconds would speak once a second for the life of the lock,
    // which is not an accessible timer — it is one that makes the rest of the
    // screen unusable.
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);
    const timer = screen.getByRole('timer');
    expect(timer).not.toHaveAttribute('aria-live');
    expect(timer.closest('[aria-live]')).toBeNull();
  });

  it('says nothing on mount, because nothing has changed yet', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(120_000)} now={at(0)} />);
    expect(announcement()).toBe('');
  });

  it('says nothing for the ticks between two thresholds', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);
    advance(10_000);
    expect(announcement()).toBe('');
    advance(60_000);
    expect(announcement()).toBe('');
  });

  it('speaks once when the clock crosses into a band', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);

    // 15:00 down to 05:00 — the first threshold.
    advance(LOCK_MS - 300_000);
    const atFiveMinutes = announcement();
    expect(atFiveMinutes).not.toBe('');

    // ...and nothing more until the next one.
    advance(60_000);
    expect(announcement()).toBe(atFiveMinutes);
  });

  it('changes what it says at each band, down to the last one', () => {
    render(<Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />);
    const said: string[] = [];

    for (const remainingSeconds of COUNTDOWN_THRESHOLDS_SECONDS) {
      const target = LOCK_MS - remainingSeconds * 1000;
      act(() => {
        vi.setSystemTime(target);
        vi.advanceTimersByTime(1000);
      });
      said.push(announcement());
    }

    expect(said).toHaveLength(COUNTDOWN_THRESHOLDS_SECONDS.length);
    expect(new Set(said).size).toBe(said.length);
    expect(said.at(-1)).toBe(COUNTDOWN_COPY.expired.he(''));
  });

  it('lets a caller supply the sentence', () => {
    render(
      <Countdown
        label="נעילת מחיר"
        expiresAt={at(LOCK_MS)}
        now={at(0)}
        announceAt={[60]}
        formatAnnouncement={(seconds) => `left:${seconds}`}
      />,
    );
    advance(LOCK_MS - 60_000);
    expect(announcement()).toBe('left:60');
  });

  it('speaks the surrounding locale', () => {
    render(
      <DirectionProvider locale="en">
        <Countdown label="Price lock" expiresAt={at(LOCK_MS)} now={at(0)} />
      </DirectionProvider>,
    );
    advance(LOCK_MS);
    expect(announcement()).toBe(COUNTDOWN_COPY.expired.en(''));
  });
});

describe('Countdown — urgency, in more than one channel', () => {
  afterEach(cleanup);

  it('is quiet while there is plenty of time', () => {
    const { container } = render(
      <Countdown label="נעילת מחיר" expiresAt={at(LOCK_MS)} now={at(0)} />,
    );
    expect(container.firstElementChild).not.toHaveAttribute('data-urgent');
    expect(screen.getByRole('timer').className).toContain('text-ink');
  });

  it('turns rust under the last minute, and says so in the DOM', () => {
    const { container } = render(
      <Countdown label="נעילת מחיר" expiresAt={at(30_000)} now={at(0)} />,
    );
    expect(container.firstElementChild).toHaveAttribute('data-urgent');
    expect(screen.getByRole('timer').className).toContain('text-rust');
  });

  it('carries the urgency in colour and in a falling number, not in motion alone', () => {
    // The pulse is the third channel. Colour survives a user who asked for
    // stillness; the number survives greyscale and sunlight.
    render(<Countdown label="נעילת מחיר" expiresAt={at(30_000)} now={at(0)} />);
    const classes = screen.getByRole('timer').className;
    expect(classes).toContain('animate-pulse');
    expect(classes).toContain('motion-reduce:animate-none');
    expect(compilesToARule('motion-reduce:animate-none')).toBe(true);
    expect(cssFor(['motion-reduce:animate-none'])).toContain('prefers-reduced-motion: reduce');
  });

  it('stops pulsing once the clock is spent, because nothing is left to hurry for', () => {
    const { container } = render(<Countdown label="נעילת מחיר" expiresAt={at(0)} now={at(1000)} />);
    expect(container.firstElementChild).toHaveAttribute('data-expired');
    expect(container.firstElementChild).not.toHaveAttribute('data-urgent');
    expect(screen.getByRole('timer').className).not.toContain('animate-pulse');
  });

  it('lets a surface choose its own urgency threshold', () => {
    const { container } = render(
      <Countdown
        label="נעילת מחיר"
        expiresAt={at(LOCK_MS)}
        now={at(0)}
        urgentBelowSeconds={LOCK_MS / 1000}
      />,
    );
    expect(container.firstElementChild).toHaveAttribute('data-urgent');
  });
});

describe('Countdown — the digits stay a clock in a Hebrew sentence', () => {
  afterEach(cleanup);

  it('isolates the run so the colon cannot be reordered around it', () => {
    const { container } = render(
      <DirectionProvider locale="he">
        <Countdown label="נעילת מחיר" expiresAt={at(67_000)} now={at(0)} />
      </DirectionProvider>,
    );
    const isolated = container.querySelector('bdi');
    expect(isolated).not.toBeNull();
    expect(isolated).toHaveAttribute('dir', 'ltr');
    expect(isolated?.textContent).toBe('01:07');
    // And it is set in the figures face, so a countdown does not jitter as the
    // digits change width.
    expect(isolated?.className).toContain('tabular');
  });
});
