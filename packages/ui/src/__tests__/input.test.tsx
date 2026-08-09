import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import {
  Input,
  InputContent,
  LtrRun,
  inputAlignmentClass,
  inputContentDirection,
  inputContentMode,
} from '../components/input.js';
import { colorCssNames, colorThemes, type ColorToken, type ThemeName } from '../tokens/color.js';
import { WCAG, contrastRatio } from '../tokens/contrast.js';
import { MIN_TAP_TARGET_PX } from '../tokens/size.js';

afterEach(cleanup);

const THEMES = ['light', 'dark'] as const satisfies readonly ThemeName[];

/** Every surface a field can be dropped onto. All three have to hold. */
const GROUNDS = ['paper', 'paper2', 'card'] as const satisfies readonly ColorToken[];

/**
 * Every colour utility in the system, by the suffix it ends in. Used to strip
 * colour out of a rendered className so that "the error is not signalled by
 * colour alone" can be *computed* rather than eyeballed.
 */
const COLOUR_SUFFIXES = new Set<string>(Object.values(colorCssNames));

/** `ink-3` back to `ink3`, so a rendered class can be measured against the palette. */
const TOKEN_BY_CSS_NAME = new Map<string, ColorToken>(
  (Object.keys(colorCssNames) as ColorToken[]).map((token) => [colorCssNames[token], token]),
);

/**
 * The palette token an element actually reaches for, read back out of what it
 * rendered.
 *
 * Deliberately not a constant the test declares for itself: the point is to
 * catch the component changing its mind, so the ratio has to be computed against
 * whatever tone is on the element now. Variant-prefixed utilities are skipped —
 * `disabled:text-ink-3` is an inactive control, which WCAG exempts, and it is
 * not the tone the field is read in.
 */
function colourTokenOf(utility: 'border' | 'text' | 'bg', className: string): ColorToken {
  const found = className
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.includes(':'))
    .flatMap((token) => {
      if (!token.startsWith(`${utility}-`)) return [];
      const named = TOKEN_BY_CSS_NAME.get(token.slice(utility.length + 1));
      return named === undefined ? [] : [named];
    });

  expect(found, `expected exactly one ${utility}-<colour> in "${className}"`).toHaveLength(1);
  const [only] = found;
  if (only === undefined) throw new Error(`no ${utility} colour in "${className}"`);
  return only;
}

function ratioIn(theme: ThemeName, a: ColorToken, b: ColorToken): number {
  const scale = colorThemes[theme];
  return contrastRatio(scale[a], scale[b]);
}

function withoutColour(className: string): string[] {
  return className
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => {
      // Strip any variant prefixes (`focus-visible:`, `disabled:`) and the
      // opacity modifier, leaving `utility-token`.
      const bare = token.split(':').at(-1) ?? '';
      const [, ...rest] = bare.split('-');
      const suffix = rest.join('-').replace(/\/\d+$/, '');
      return !COLOUR_SUFFIXES.has(suffix);
    });
}

describe('Input — label association', () => {
  it('associates a generated id when the caller supplies none', () => {
    render(<Input label="שם מלא" />);

    const field = screen.getByLabelText('שם מלא');
    expect(field).toBeInstanceOf(HTMLInputElement);
    expect(field.id).not.toBe('');
    expect(document.querySelector('label')?.getAttribute('for')).toBe(field.id);
  });

  it('honours an explicit id, because a form may already own its ids', () => {
    render(<Input id="phone-field" label="טלפון" />);
    expect(screen.getByLabelText('טלפון').id).toBe('phone-field');
  });

  it('holds the tap-target floor on the field itself', () => {
    render(<Input label="שם מלא" />);
    const height = Number.parseFloat(screen.getByLabelText('שם מלא').style.minBlockSize);
    expect(height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
  });
});

/**
 * A field the customer cannot find the edge of, carrying a hint they cannot
 * read, is the failure mode in sunlight — and it is not a failure any render
 * assertion can see, because both faults are a class name that is present and
 * spelled correctly. So the tone is read back off the element and the ratio is
 * computed, in both themes, against every ground a field can sit on.
 */
describe('Input — the field can be found and the hint can be read', () => {
  const BOUNDARIES = [
    { name: 'a healthy field', node: <Input label="שם מלא" /> },
    { name: 'a field in error', node: <Input label="שם מלא" error="חסרה ספרה" /> },
  ] as const;

  it.each(BOUNDARIES)('$name draws a boundary that clears 3:1 in both themes', ({ node }) => {
    render(node);
    const field = screen.getByLabelText('שם מלא');
    const border = colourTokenOf('border', field.className);
    const fill = colourTokenOf('bg', field.className);

    for (const theme of THEMES) {
      // Against its own fill and against the page behind it. A boundary that
      // separates from only one of the two is a boundary that disappears the
      // moment the field is moved onto the other surface — and `line`, the
      // hairline this reached for first, fails against both at 1.41:1 and 1.29:1.
      expect(
        ratioIn(theme, border, fill),
        `${theme}: border on the field's own fill`,
      ).toBeGreaterThanOrEqual(WCAG.nonText);
      expect(
        ratioIn(theme, border, 'paper'),
        `${theme}: border on the page`,
      ).toBeGreaterThanOrEqual(WCAG.nonText);
    }
  });

  it('sets the hint in a tone that clears AA body text on every ground', () => {
    render(<Input label="טלפון" hint="לדוגמה 052-1234567" />);
    const hint = screen.getByText('לדוגמה 052-1234567');
    const tone = colourTokenOf('text', hint.className);

    // No size class on the hint, so it is body text by definition and 4.5:1 is
    // the bar — including on `paper`, where `ink-3` measures 4.23:1 and where a
    // field that is not inside a Card actually sits.
    for (const theme of THEMES) {
      for (const ground of GROUNDS) {
        expect(ratioIn(theme, tone, ground), `${theme}: hint on ${ground}`).toBeGreaterThanOrEqual(
          WCAG.aaBody,
        );
      }
    }
  });

  it('keeps the error sentence readable on the ground the invalid field puts it beside', () => {
    render(<Input label="טלפון" error="חסרה ספרה" />);
    const message = screen.getByRole('alert');
    const tone = colourTokenOf('text', message.className);

    for (const theme of THEMES) {
      for (const ground of GROUNDS) {
        expect(ratioIn(theme, tone, ground), `${theme}: error on ${ground}`).toBeGreaterThanOrEqual(
          WCAG.aaBody,
        );
      }
    }
  });
});

describe('Input — errors are announced, associated, and not colour alone', () => {
  it('marks the field invalid and points describedby at the message', () => {
    render(<Input label="טלפון" error="מספר הטלפון אינו תקין" />);

    const field = screen.getByLabelText('טלפון');
    const message = screen.getByRole('alert');

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(message).toHaveTextContent('מספר הטלפון אינו תקין');
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
  });

  it('describes the field by hint and error together, in reading order', () => {
    render(<Input label="טלפון" hint="לדוגמה 052-1234567" error="חסרה ספרה" />);

    const field = screen.getByLabelText('טלפון');
    const described = field.getAttribute('aria-describedby')?.split(' ') ?? [];

    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0] ?? '')).toHaveTextContent('לדוגמה 052-1234567');
    expect(document.getElementById(described[1] ?? '')).toHaveTextContent('חסרה ספרה');
  });

  it('keeps a caller-supplied describedby instead of overwriting it', () => {
    render(
      <>
        <p id="outside">כל השדות חובה</p>
        <Input label="טלפון" aria-describedby="outside" error="חסרה ספרה" />
      </>,
    );

    const described =
      screen.getByLabelText('טלפון').getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described[0]).toBe('outside');
    expect(described).toHaveLength(2);
  });

  it('signals the error with something other than colour', () => {
    render(<Input label="טלפון" />);
    const validClasses = withoutColour(screen.getByLabelText('טלפון').className);
    expect(document.querySelector('svg[aria-hidden="true"]')).toBeNull();
    cleanup();

    render(<Input label="טלפון" error="חסרה ספרה" />);
    const invalidClasses = withoutColour(screen.getByLabelText('טלפון').className);

    // Strip every colour utility from both renderings: what is left must still
    // differ, or the only thing telling a colour-blind customer that this field
    // failed is a hue they cannot see.
    const added = invalidClasses.filter((token) => !validClasses.includes(token));
    expect(added.length).toBeGreaterThan(0);

    expect(document.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('leaves a healthy field unmarked', () => {
    render(<Input label="טלפון" hint="לדוגמה 052-1234567" />);
    const field = screen.getByLabelText('טלפון');

    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Input — bidi isolation', () => {
  it('declares one direction per content kind', () => {
    expect(inputContentDirection[InputContent.Text].dir).toBe('auto');
    expect(inputContentDirection[InputContent.Phone].dir).toBe('ltr');
    expect(inputContentDirection[InputContent.Money].dir).toBe('ltr');
    expect(inputContentDirection[InputContent.Digits].dir).toBe('ltr');
  });

  it('does not force a direction on Hebrew prose', () => {
    render(<Input label="רחוב" defaultValue="דיזנגוף" />);
    // `auto` and not `rtl`: the same field filled in English has to lay itself
    // out the other way without the caller changing anything.
    expect(screen.getByLabelText('רחוב')).toHaveAttribute('dir', 'auto');
  });

  it('isolates a phone field so the leading + cannot jump to the far side', () => {
    render(<Input label="טלפון" content={InputContent.Phone} defaultValue="+972-52-123-4567" />);

    const field = screen.getByLabelText('טלפון');
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(field).toHaveAttribute('inputmode', inputContentMode.phone);
  });

  it('raises the digit keyboard for money and for counts', () => {
    render(<Input label="סכום" content={InputContent.Money} />);
    expect(screen.getByLabelText('סכום')).toHaveAttribute('inputmode', 'decimal');
    cleanup();

    render(<Input label="קומה" content={InputContent.Digits} />);
    expect(screen.getByLabelText('קומה')).toHaveAttribute('inputmode', 'numeric');
  });

  it('wraps a phone number quoted inside a Hebrew label in a bidi isolate', () => {
    render(
      <Input
        label={
          <>
            {'טלפון '}
            <LtrRun>+972-52-123-4567</LtrRun>
          </>
        }
        content={InputContent.Phone}
      />,
    );

    const label = document.querySelector('label');
    const isolate = label?.querySelector('bdi');

    expect(isolate).not.toBeNull();
    expect(isolate).toHaveAttribute('dir', 'ltr');
    expect(isolate?.textContent).toBe('+972-52-123-4567');
    // `<bdi>` and not `<span dir="ltr">`: the isolation has to work in both
    // directions, or the Hebrew around the number is what gets rearranged.
    expect(label?.innerHTML).toContain('<bdi');
    expect(label?.textContent).toBe('טלפון +972-52-123-4567');
  });
});

/**
 * `text-align: start` resolves against the *element's* direction, so the field
 * that was forced to `dir="ltr"` to keep a phone number intact is the same field
 * whose value walks to the far side of a Hebrew form. The `dir` attribute is
 * therefore not enough to test: what has to be asserted is the physical edge the
 * two declarations actually land on together.
 */
const PHYSICAL_EDGE = {
  ltr: { start: 'left', end: 'right' },
  rtl: { start: 'right', end: 'left' },
} as const;

type Edge = (typeof PHYSICAL_EDGE)['ltr'][keyof (typeof PHYSICAL_EDGE)['ltr']];

/** The single alignment utility an element is allowed to carry. */
function alignmentOf(className: string): 'start' | 'end' {
  const found = className
    .split(/\s+/)
    .filter((token) => token === 'text-start' || token === 'text-end');
  expect(found, `expected exactly one alignment class in "${className}"`).toHaveLength(1);
  return found[0] === 'text-end' ? 'end' : 'start';
}

function edgeOf(element: Element, direction: 'ltr' | 'rtl'): Edge {
  return PHYSICAL_EDGE[direction][alignmentOf(element.className)];
}

/**
 * What each content kind must render on each page, written out here rather than
 * derived from `inputContentDirection` — a table that checks itself proves
 * nothing. `text-end` on a forced-LTR field and `text-start` on the Hebrew label
 * beside it are the same edge; that equality is the whole fix.
 */
const BIDI_PAIRINGS = [
  { page: 'he', direction: 'rtl', content: InputContent.Text, dir: 'auto', align: 'text-start' },
  { page: 'he', direction: 'rtl', content: InputContent.Phone, dir: 'ltr', align: 'text-end' },
  { page: 'he', direction: 'rtl', content: InputContent.Money, dir: 'ltr', align: 'text-end' },
  { page: 'he', direction: 'rtl', content: InputContent.Digits, dir: 'ltr', align: 'text-end' },
  { page: 'en', direction: 'ltr', content: InputContent.Text, dir: 'auto', align: 'text-start' },
  { page: 'en', direction: 'ltr', content: InputContent.Phone, dir: 'ltr', align: 'text-start' },
  { page: 'en', direction: 'ltr', content: InputContent.Money, dir: 'ltr', align: 'text-start' },
  { page: 'en', direction: 'ltr', content: InputContent.Digits, dir: 'ltr', align: 'text-start' },
] as const;

describe('Input — a forced direction must not drag the alignment with it', () => {
  it('covers every content kind on both pages', () => {
    // The table above is written by hand, so the guard against a kind being
    // added and quietly untested belongs here.
    for (const content of Object.values(InputContent)) {
      expect(BIDI_PAIRINGS.filter((pairing) => pairing.content === content)).toHaveLength(2);
    }
  });

  it('lets a field align to itself only while its direction is still its own', () => {
    for (const content of Object.values(InputContent)) {
      const { dir, align } = inputContentDirection[content];
      expect(align === 'content', content).toBe(dir === 'auto');
    }
  });

  it.each(BIDI_PAIRINGS)(
    '$content on a $page page: $dir, $align',
    ({ page, direction, content, dir, align }) => {
      render(
        <DirectionProvider locale={page}>
          <Input label="קומה" content={content} />
        </DirectionProvider>,
      );

      const field = screen.getByLabelText('קומה');
      const label = document.querySelector('label');

      expect(field).toHaveAttribute('dir', dir);
      expect(field.className.split(/\s+/)).toContain(align);
      expect(alignmentOf(field.className)).toBe(align === 'text-end' ? 'end' : 'start');

      // The label carries no `dir` of its own, so it reads the page's.
      expect(label).not.toBeNull();
      if (label === null) return;
      expect(label.hasAttribute('dir')).toBe(false);

      if (dir === 'auto') {
        // Nothing to compare against: an `auto` field resolves its direction from
        // the value, which is exactly the freedom prose is supposed to keep.
        expect(alignmentOf(field.className)).toBe('start');
        return;
      }

      expect(edgeOf(field, dir), `${content} on a ${direction} page`).toBe(
        edgeOf(label, direction),
      );
    },
  );

  it('does not send a digits field to the far side of a Hebrew form', () => {
    // The finding, stated as an assertion: `text-start` here means the left edge,
    // because the field itself was forced to LTR.
    render(
      <DirectionProvider locale="he">
        <Input label="קומה" content={InputContent.Digits} />
      </DirectionProvider>,
    );

    const classes = screen.getByLabelText('קומה').className.split(/\s+/);
    expect(classes).toContain('text-end');
    expect(classes).not.toContain('text-start');
  });

  it('holds with no provider at all, because Hebrew is the default and not a mode', () => {
    render(<Input label="קומה" content={InputContent.Digits} />);
    expect(screen.getByLabelText('קומה').className.split(/\s+/)).toContain('text-end');
  });

  it('lets a caller overrule the alignment for a field the table cannot describe', () => {
    render(<Input label="קומה" content={InputContent.Digits} inputClassName="text-start" />);
    const classes = screen.getByLabelText('קומה').className.split(/\s+/);
    expect(classes).toContain('text-start');
    expect(classes).not.toContain('text-end');
  });

  it('resolves the class from the content kind and the page, and from nothing else', () => {
    expect(inputAlignmentClass(InputContent.Text, true)).toBe('text-start');
    expect(inputAlignmentClass(InputContent.Text, false)).toBe('text-start');
    expect(inputAlignmentClass(InputContent.Digits, true)).toBe('text-end');
    expect(inputAlignmentClass(InputContent.Digits, false)).toBe('text-start');
  });
});
