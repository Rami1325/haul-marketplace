import { AccessDetailsSchema, AddressSchema, ManifestSchema, StopKind } from '@haul/types';
import { describe, expect, it } from 'vitest';
import {
  BOOKING_DRAFT_VERSION,
  BookingDraftSchema,
  DraftAddressSchema,
  DraftStopSchema,
  newBookingDraft,
  newDraftStop,
} from '../draft.js';
import { completeDraft, completeDraftInput } from './fixtures.js';

/**
 * The premise, checked rather than assumed: the domain schemas genuinely cannot
 * hold a form in progress. If any of these started passing, the draft schema
 * would be duplication rather than necessity and should be deleted.
 */
describe('the domain schemas cannot represent a booking in progress', () => {
  it('refuses an empty basket', () => {
    expect(ManifestSchema.safeParse({ lines: [] }).success).toBe(false);
  });

  it('refuses an address the customer has not finished typing', () => {
    expect(AddressSchema.safeParse({}).success).toBe(false);
    expect(AddressSchema.safeParse({ street: 'דיזנגוף' }).success).toBe(false);
  });

  it('refuses access details nobody has been asked about', () => {
    expect(AccessDetailsSchema.safeParse({}).success).toBe(false);
  });

  it('is the reason the draft answers are nullable rather than optional domain fields', () => {
    // The draft holds exactly the state the three schemas above reject.
    const empty = BookingDraftSchema.parse({ version: BOOKING_DRAFT_VERSION });
    expect(empty.basket).toEqual([]);
    expect(empty.stops).toEqual([]);
    expect(empty.at).toBeNull();
  });
});

describe('a draft is a document, not a domain object', () => {
  it('survives a round trip through jsonb unchanged', () => {
    const draft = completeDraft();
    const stored: unknown = JSON.parse(JSON.stringify(draft));
    expect(BookingDraftSchema.parse(stored)).toEqual(draft);
  });

  it('holds no Date anywhere, so nothing depends on how it was serialised', () => {
    const draft = completeDraft();
    const dates: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value instanceof Date) dates.push(path);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}.${i}`));
      else if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) walk(v, `${path}.${key}`);
      }
    };
    walk(draft, 'draft');
    expect(dates).toEqual([]);
    expect(typeof draft.at).toBe('string');
  });

  it('drops keys it does not know, so a client cannot smuggle a field in', () => {
    const parsed = BookingDraftSchema.parse({
      ...completeDraftInput(),
      craneRules: { craneFromFloor: 60, neverBelowFloor: 60 },
      lockedTotal: 1,
    });
    expect(parsed).not.toHaveProperty('craneRules');
    expect(parsed).not.toHaveProperty('lockedTotal');
  });

  it('is versioned, and refuses a version it was not written for', () => {
    expect(BookingDraftSchema.safeParse({ version: BOOKING_DRAFT_VERSION }).success).toBe(true);
    expect(BookingDraftSchema.safeParse({ version: BOOKING_DRAFT_VERSION + 1 }).success).toBe(
      false,
    );
    expect(BookingDraftSchema.safeParse({}).success).toBe(false);
  });
});

describe('a draft relaxes presence, never validity', () => {
  it('accepts every answer missing', () => {
    const stop = newDraftStop(StopKind.Pickup);
    expect(stop.address.street).toBeNull();
    expect(stop.access.floor).toBeNull();
    expect(stop.access.crane).toBeNull();
  });

  it('refuses a value the domain field could never hold', () => {
    const tooLong = 'א'.repeat(201);
    expect(DraftAddressSchema.safeParse({ street: tooLong }).success).toBe(false);
    expect(AddressSchema.shape.street.safeParse(tooLong).success).toBe(false);
  });

  it('applies the domain postal-code rule rather than deferring it to quote time', () => {
    expect(DraftAddressSchema.safeParse({ postalCode: '6473424' }).success).toBe(true);
    expect(DraftAddressSchema.safeParse({ postalCode: '64734' }).success).toBe(true);
    expect(DraftAddressSchema.safeParse({ postalCode: 'abcde' }).success).toBe(false);
  });

  it('checks a phone number without rewriting it, so a draft save never fails on formatting', () => {
    const stop = DraftStopSchema.parse({ kind: StopKind.Pickup, contactPhone: '052-123-4567' });
    // Still exactly what the customer typed. Normalisation belongs at booking.
    expect(stop.contactPhone).toBe('052-123-4567');
    expect(
      DraftStopSchema.safeParse({ kind: StopKind.Pickup, contactPhone: '03-1234567' }).success,
    ).toBe(false);
  });

  it('treats a blank field as unanswered rather than as an answer of ""', () => {
    const parsed = DraftAddressSchema.parse({ street: '   ', city: '\t' });
    expect(parsed.street).toBeNull();
    expect(parsed.city).toBeNull();
  });

  it('trims what it does keep', () => {
    expect(DraftAddressSchema.parse({ street: '  דיזנגוף  ' }).street).toBe('דיזנגוף');
  });

  it('lets a basket row sit at zero, because that is how an item is removed', () => {
    const draft = completeDraft({ basket: [{ catalogItemId: 'box_small', quantity: 0 }] });
    expect(draft.basket[0]?.quantity).toBe(0);
  });

  it('refuses a chosen slot that does not say which timezone it is in', () => {
    // "2026-08-12T10:00:00" is three different instants depending on who wrote
    // it, and the one thing this field decides is which day and hour the job
    // prices at. An offset or a Z, or it is not an answer.
    expect(
      BookingDraftSchema.safeParse({ ...completeDraftInput(), at: '2026-08-12T10:00:00' }).success,
    ).toBe(false);
    expect(
      BookingDraftSchema.safeParse({ ...completeDraftInput(), at: '2026-08-12T10:00:00+03:00' })
        .success,
    ).toBe(true);
    expect(
      BookingDraftSchema.safeParse({ ...completeDraftInput(), at: '2026-08-12' }).success,
    ).toBe(false);
  });
});

describe('the empty-draft constructors', () => {
  it('seeds the two stops every move has, in order', () => {
    const draft = newBookingDraft('tel-aviv');
    expect(draft.stops.map((s) => s.kind)).toEqual([StopKind.Pickup, StopKind.Dropoff]);
    expect(draft.cityId).toBe('tel-aviv');
    expect(draft.locale).toBe('he');
  });

  it('answers nothing on the customer’s behalf', () => {
    const draft = newBookingDraft('tel-aviv');
    expect(draft.basket).toEqual([]);
    expect(draft.scheduleKind).toBeNull();
    expect(draft.at).toBeNull();
    expect(draft.routedDistanceMeters).toBeNull();
    expect(draft.vehicleClassId).toBeNull();
    expect(draft.crewSize).toBeNull();
    expect(draft.promoCode).toBeNull();
  });

  it('gives each stop its own objects rather than one shared default', () => {
    const draft = newBookingDraft('tel-aviv');
    expect(draft.stops[0]?.address).not.toBe(draft.stops[1]?.address);
    expect(draft.stops[0]?.access).not.toBe(draft.stops[1]?.access);
  });
});
