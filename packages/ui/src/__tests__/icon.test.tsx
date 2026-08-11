import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionProvider } from '../components/direction.js';
import { Icon, iconSizeClasses } from '../components/icon.js';
import {
  FALLBACK_ICON,
  ICON_GLYPHS,
  glyphFor,
  iconNames,
  isDirectionalGlyph,
  isIconName,
  resolveIconName,
  type IconName,
} from '../icons/registry.js';
import { MIN_TAP_TARGET_PX, iconSizesPx } from '../tokens/size.js';
import { resolvedPx } from './helpers/stylesheet.js';

/**
 * Two claims are being checked and they are different claims.
 *
 * The registry's: that a directional glyph is genuinely two drawings and that
 * the twins are twins. `__tests__/rtl.test.ts` already refuses a horizontal flip
 * anywhere in the source, so what is left is whether the drawings this file
 * chooses between are actually mirror images of one another — a pair that
 * silently stopped being a pair is an arrow pointing back the way the customer
 * came, in Hebrew only, with every test still green.
 *
 * The component's: that the drawing it paints is chosen from the reading
 * direction, that a glyph with no name stays out of the accessibility tree, and
 * that the size class it writes has CSS behind it.
 */

afterEach(cleanup);

/** The seven `ManifestPreset.icon` keys the config package ships. */
const PRESET_ICON_KEYS = [
  'studio',
  'apartment-2',
  'apartment-3',
  'apartment-4',
  'apartment-5-plus',
  'sofa',
  'boxes',
] as const;

/**
 * The `CatalogItem.icon` keys carrying the most rows. Not the whole catalog —
 * the starter set is deliberately partial — but the ones whose absence would
 * leave the first screen visibly unfinished.
 */
const COMMON_CATALOG_ICON_KEYS = [
  'table',
  'bed',
  'box',
  'cabinet',
  'sofa',
  'chair',
  'mattress',
  'wardrobe',
  'fridge',
  'ac',
  'piano',
  'tv',
  'desk',
  'plant',
] as const;

function pathData(container: HTMLElement): string[] {
  return [...container.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');
}

function renderIcon(name: IconName, locale: 'he' | 'en'): string[] {
  const { container } = render(
    <DirectionProvider locale={locale}>
      <Icon name={name} />
    </DirectionProvider>,
  );
  const data = pathData(container);
  cleanup();
  return data;
}

describe('the registry', () => {
  it('holds a glyph for every preset the config package ships', () => {
    for (const key of PRESET_ICON_KEYS) {
      expect(isIconName(key), key).toBe(true);
    }
  });

  it('holds a glyph for the catalog keys that carry the most rows', () => {
    for (const key of COMMON_CATALOG_ICON_KEYS) {
      expect(isIconName(key), key).toBe(true);
    }
  });

  it('resolves a key it has never heard of instead of throwing', () => {
    // `CatalogItem.icon` is an open string edited by an operator. A row naming a
    // glyph nobody has drawn must not be able to take the item picker down.
    expect(resolveIconName('trampoline')).toBe(FALLBACK_ICON);
    expect(resolveIconName('')).toBe(FALLBACK_ICON);
    expect(resolveIconName('sofa')).toBe('sofa');
  });

  it('falls back to a neutral placeholder, never to a plausible wrong object', () => {
    // A box drawn for a treadmill is the icon telling the customer something
    // untrue about what we are about to carry.
    expect(FALLBACK_ICON).toBe('question');
    expect(resolveIconName('treadmill')).not.toBe('box');
  });

  it('lets a surface name its own fallback', () => {
    expect(resolveIconName('treadmill', 'box')).toBe('box');
  });

  it('lists every glyph it holds, and nothing it does not', () => {
    expect(iconNames.length).toBe(Object.keys(ICON_GLYPHS).length);
    expect(iconNames.length).toBeGreaterThan(30);
    for (const name of iconNames) expect(isIconName(name), name).toBe(true);
  });

  it.each(iconNames)('%s draws at least one path, and no two the same', (name) => {
    const definition = ICON_GLYPHS[name];
    for (const glyph of isDirectionalGlyph(definition)
      ? [definition.rtl, definition.ltr]
      : [definition]) {
      expect(glyph.paths.length).toBeGreaterThan(0);
      // The component keys its `<path>` elements by their own data, and React
      // silently drops a duplicate key — so a glyph with two identical paths
      // would render one of them.
      expect(new Set(glyph.paths).size).toBe(glyph.paths.length);
    }
  });

  it.each(iconNames)('%s carries no transform of its own', (name) => {
    // The whole point of holding two drawings is that nothing is being flipped.
    const definition = ICON_GLYPHS[name];
    const everyPath = isDirectionalGlyph(definition)
      ? [...definition.rtl.paths, ...definition.ltr.paths]
      : [...definition.paths];
    for (const d of everyPath) {
      expect(d).not.toMatch(/scale|rotate|matrix|translate/i);
    }
  });
});

describe('directional glyphs are mirrored twins', () => {
  const directional = iconNames.filter((name) => isDirectionalGlyph(ICON_GLYPHS[name]));

  it('has some, so this block is not vacuous', () => {
    expect(directional.length).toBeGreaterThanOrEqual(4);
  });

  it.each(directional)('%s draws something different in each direction', (name) => {
    const definition = ICON_GLYPHS[name];
    expect(isDirectionalGlyph(definition)).toBe(true);
    if (!isDirectionalGlyph(definition)) return;
    expect(definition.rtl.paths).not.toEqual(definition.ltr.paths);
  });

  it.each([
    ['chevron-start', 'chevron-end'],
    ['arrow-start', 'arrow-end'],
  ] as const)('%s and %s are the same drawing, swapped', (start, end) => {
    // What "start" and "end" mean: the glyph that points toward the reading end
    // in Hebrew is the one that points toward the reading start in English.
    const a = ICON_GLYPHS[start];
    const b = ICON_GLYPHS[end];
    expect(isDirectionalGlyph(a) && isDirectionalGlyph(b)).toBe(true);
    if (!isDirectionalGlyph(a) || !isDirectionalGlyph(b)) return;
    expect(a.ltr.paths).toEqual(b.rtl.paths);
    expect(a.rtl.paths).toEqual(b.ltr.paths);
  });

  it('hands back the right drawing for the direction it is asked about', () => {
    const chevron = ICON_GLYPHS['chevron-end'];
    expect(glyphFor(chevron, true)).toBe(isDirectionalGlyph(chevron) ? chevron.rtl : chevron);
    expect(glyphFor(chevron, false)).toBe(isDirectionalGlyph(chevron) ? chevron.ltr : chevron);
  });

  it('ignores the direction for a glyph that has only one drawing', () => {
    const check = ICON_GLYPHS.check;
    expect(glyphFor(check, true)).toBe(glyphFor(check, false));
  });
});

describe('Icon — what reaches the screen', () => {
  it('paints a different arrow in Hebrew than in English', () => {
    const hebrew = renderIcon('arrow-end', 'he');
    const english = renderIcon('arrow-end', 'en');
    expect(hebrew).not.toEqual(english);
  });

  it('paints the same clock in both, because a clock has no reading direction', () => {
    expect(renderIcon('clock', 'he')).toEqual(renderIcon('clock', 'en'));
  });

  it('defaults to Hebrew with no provider above it, because that is the product', () => {
    const { container } = render(<Icon name="chevron-end" />);
    expect(pathData(container)).toEqual(renderIcon('chevron-end', 'he'));
  });

  it('never mirrors with a transform attribute', () => {
    const { container } = render(
      <DirectionProvider locale="he">
        <Icon name="arrow-start" />
      </DirectionProvider>,
    );
    const svg = container.querySelector('svg');
    expect(svg?.hasAttribute('transform')).toBe(false);
    expect(svg?.getAttribute('style') ?? '').not.toMatch(/scale|rotate|matrix/i);
  });

  it('says which glyphs were chosen from the direction and which were not', () => {
    const { container } = render(<Icon name="chevron-end" />);
    expect(container.querySelector('[data-icon="chevron-end"]')).toHaveAttribute(
      'data-directional',
    );

    cleanup();

    const plain = render(<Icon name="check" />).container;
    expect(plain.querySelector('[data-icon="check"]')).not.toHaveAttribute('data-directional');
  });
});

describe('Icon — naming, or the deliberate absence of one', () => {
  it('stays out of the accessibility tree when nobody named it', () => {
    // The common case is a glyph beside text that already says the same thing,
    // and announcing it twice is how people turn assistive markup off.
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('becomes an image with a name when one is given', () => {
    render(<Icon name="warning" label="אזהרה" />);
    const image = screen.getByRole('img', { name: 'אזהרה' });
    expect(image).not.toHaveAttribute('aria-hidden');
  });

  it('ships no default word in either language', () => {
    // A Hebrew-first product cannot have English chrome leaking out of its
    // design system, and a Hebrew default is the same bug on an English screen.
    const { container } = render(<Icon name="close" />);
    expect(container.querySelector('svg')?.textContent).toBe('');
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBeNull();
  });
});

describe('Icon — a glyph is not a tap target', () => {
  it.each(['sm', 'md', 'lg', 'xl'] as const)(
    '%s resolves to the icon token, through the CSS',
    (size) => {
      // Read out of the compiled stylesheet, not out of the class attribute: an
      // interpolated `size-[…]` writes a convincing class and emits no rule.
      const className = iconSizeClasses[size];
      expect(resolvedPx(className, 'width'), className).toBe(iconSizesPx[size]);
      expect(resolvedPx(className, 'height'), className).toBe(iconSizesPx[size]);
    },
  );

  it('stays smaller than the tap-target floor at every size', () => {
    // The glyph is what you see; the target is what you hit. An icon-only
    // control gets the floor from the control around it.
    for (const size of ['sm', 'md', 'lg', 'xl'] as const) {
      expect(iconSizesPx[size], size).toBeLessThan(MIN_TAP_TARGET_PX);
    }
  });

  it('lets a caller’s className win over the size it chose', () => {
    render(<Icon name="check" size="sm" className="size-(--icon-xl)" label="נבחר" />);
    const classes = screen.getByRole('img').classList;
    expect(classes.contains('size-(--icon-xl)')).toBe(true);
    expect(classes.contains('size-(--icon-sm)')).toBe(false);
  });
});
