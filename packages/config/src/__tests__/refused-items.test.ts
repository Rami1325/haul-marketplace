import { describe, expect, it } from 'vitest';
import { CATALOG, REFUSED_ITEMS, isRefusedLabel } from '../catalog.js';

/**
 * ---------------------------------------------------------------------------
 * Refusing a free-text item
 * ---------------------------------------------------------------------------
 * The "other item" field is the one place a customer can name anything, and an
 * LPG cylinder loaded onto a truck is an uninsured loss — the single failure in
 * this catalog that is not a pricing error but an existential one.
 *
 * Which makes both directions expensive. A miss carries the cylinder. A false
 * positive refuses a Weber, a gas hob or an empty dog crate, all of which are
 * priced rows in the catalog, and does it with a scary sentence about dangerous
 * goods. So the suite spends as much on what must NOT be refused.
 * ---------------------------------------------------------------------------
 */

const refusedId = (text: string) => isRefusedLabel(text)?.item.id ?? null;

describe('the gas cylinder, however it is typed', () => {
  it('catches the canonical Hebrew', () => {
    expect(refusedId('בלון גז')).toBe('gas_balloon');
  });

  it('catches it through the ways a phone keyboard mangles it', () => {
    for (const typed of [
      'בלוני גז', // plural — the final nun changes letter, so this is not a prefix
      'בלון',
      'בָּלוֹן גָז', // niqqud
      'בלון־גז', // maqaf
      '  בלון   גז  ',
      'הבלון גז שלי',
      'בלון גז 12 קג',
      'מיכל גז',
    ]) {
      expect(refusedId(typed), typed).toBe('gas_balloon');
    }
  });

  it('catches English and transliteration', () => {
    for (const typed of ['gas cylinder', 'Gas Bottle', 'LPG', 'propane tank', 'balon gaz']) {
      expect(refusedId(typed), typed).toBe('gas_balloon');
    }
  });

  it('comes back with a reason in both languages', () => {
    const match = isRefusedLabel('בלון גז');
    expect(match).not.toBeNull();
    expect(match!.item.reasonHe.length).toBeGreaterThan(0);
    expect(match!.item.reasonEn.length).toBeGreaterThan(0);
    // The spelling that matched is worth keeping: it is evidence about what
    // customers call the thing.
    expect(match!.matchedOn.length).toBeGreaterThan(0);
  });
});

describe('the other two refusals', () => {
  it('catches flammables and pesticides', () => {
    for (const typed of ['ג׳ריקן דלק', 'בנזין', 'חומרים מסוכנים', 'paint thinner', 'pesticide']) {
      expect(refusedId(typed), typed).toBe('hazardous_chemicals');
    }
  });

  it('catches a live animal', () => {
    for (const typed of ['כלב', 'חתול', 'בעלי חיים', 'parrot', 'live animals']) {
      expect(refusedId(typed), typed).toBe('live_animals');
    }
  });
});

describe('what must never be refused', () => {
  it('lets through the gas appliances we actually carry', () => {
    // Every one of these contains גז. A substring match on the word would refuse
    // three priced catalog rows and tell the customer they are dangerous goods.
    for (const typed of [
      'גריל גז',
      'כיריים גז',
      'תנור גז',
      'מנגל גז',
      'gas grill',
      'gas hob',
      // Described rather than named, so the exact-label shortcut cannot help.
      'גריל גז גדול עם מכסה',
      'large gas barbecue with a lid',
    ]) {
      expect(refusedId(typed), typed).toBeNull();
    }
  });

  it('still refuses the cylinder that came with the grill', () => {
    // The deliberate asymmetry: the container guard exists for the pet carrier,
    // because we sell the carrier. There is no such reading of "בלון גז" — a
    // cylinder for a barbecue is the same dangerous goods as any other.
    expect(refusedId('בלון גז לגריל')).toBe('gas_balloon');
    expect(refusedId('gas cylinder for the bbq')).toBe('gas_balloon');
  });

  it('lets through the empty pet carrier, which is a catalog row', () => {
    for (const typed of ['כלוב הובלה לחיית מחמד', 'כלוב לכלב', 'כלוב לחתול ריק', 'dog crate']) {
      expect(refusedId(typed), typed).toBeNull();
    }
  });

  it('lets through every catalog item under its own name', () => {
    for (const item of CATALOG) {
      expect(refusedId(item.nameHe), item.id).toBeNull();
      expect(refusedId(item.nameEn), item.id).toBeNull();
    }
  });

  it('lets through every catalog item described rather than named exactly', () => {
    // The exact-label shortcut cannot save these, so this is the matcher itself
    // being asked whether it over-triggers on ordinary phrasing.
    for (const item of CATALOG) {
      expect(refusedId(`${item.nameHe} ישן`), item.id).toBeNull();
      expect(refusedId(`old ${item.nameEn}`), item.id).toBeNull();
    }
  });

  it('says nothing about an empty or meaningless field', () => {
    for (const typed of ['', '   ', '???', '12']) {
      expect(refusedId(typed), JSON.stringify(typed)).toBeNull();
    }
  });
});

describe('the refusal list itself', () => {
  it('recognises each of its own entries by name and by every alias', () => {
    // An alias nothing matches is an alias somebody believed was doing work.
    for (const item of REFUSED_ITEMS) {
      for (const label of [item.nameHe, item.nameEn, ...item.aliases]) {
        expect(refusedId(label), `${item.id} → ${label}`).not.toBeNull();
      }
    }
  });

  it('gives every entry a reason in both languages', () => {
    for (const item of REFUSED_ITEMS) {
      expect(item.reasonHe.length, item.id).toBeGreaterThan(0);
      expect(item.reasonEn.length, item.id).toBeGreaterThan(0);
    }
  });

  it('does not duplicate a catalog id', () => {
    // A row that is both sellable and refused would price and then be refused.
    for (const item of REFUSED_ITEMS) {
      expect(
        CATALOG.some((entry) => entry.id === item.id),
        item.id,
      ).toBe(false);
    }
  });
});
