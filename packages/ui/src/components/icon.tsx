'use client';

import type { ComponentProps, ReactElement } from 'react';
import {
  ICON_GLYPHS,
  ICON_STROKE_WIDTH,
  ICON_VIEWBOX,
  glyphFor,
  isDirectionalGlyph,
  type IconName,
} from '../icons/index.js';
import { cn } from '../lib/cn.js';
import type { IconSize } from '../tokens/size.js';
import { useDirection } from './direction.js';

/**
 * ---------------------------------------------------------------------------
 * Icon
 * ---------------------------------------------------------------------------
 * One painter for the whole glyph set, which is what makes the stroke weight,
 * the box and the colour behaviour single decisions rather than 39 of them.
 * Every drawing lives in `src/icons`; this file knows how to put one on a screen
 * and nothing about what any of them look like.
 *
 * **The direction lookup happens here and nowhere else.** A directional glyph is
 * two drawings — see the registry's header on why it is not one drawing and a
 * flip — and the choice between them is `useDirection().isRtl`. Keeping that in
 * the one component means a call site asks for `chevron-end` and is simply
 * correct in both languages; the alternative, every caller branching on the
 * locale, is the same conditional written thirty times and got wrong once.
 *
 * **A glyph is decoration until someone gives it a word.** With no `label` the
 * SVG is `aria-hidden`, because the overwhelmingly common case is an icon beside
 * text that already says the same thing, and announcing it twice is how people
 * end up turning assistive markup off. `label` turns it into `role="img"` with a
 * name, which is what an icon-only control needs — and there is no default for
 * that word anywhere in this file, for the reason the rest of the package gives:
 * a Hebrew-first product cannot have English chrome leaking out of its design
 * system.
 *
 * **The size is a class naming a custom property, never an interpolated value.**
 * `size-(--icon-md)` is a literal the Tailwind scanner can find; the shorter
 * `size-[${iconSizes[size]}]` compiles to no CSS at all and leaves the glyph at
 * whatever an untouched `<svg>` happens to be. That failure renders perfectly in
 * jsdom, which is why `__tests__/tailwind.test.ts` compiles instead of reading
 * class attributes.
 *
 * An icon is not a tap target and this component does not pretend otherwise. The
 * largest glyph here is 32px against a 44px floor; an icon-only control gets the
 * floor from the control around it — `Button`, `Chip`, the Sheet's close — and
 * `tokens/size.ts` states that separation directly.
 * ---------------------------------------------------------------------------
 */

/**
 * Written out per size rather than generated. The classes have to survive
 * Tailwind's source scan, and the token they point at is generated into
 * `theme.css` from `iconSizes`, so there is still one source for the number.
 */
export const iconSizeClasses = {
  sm: 'size-(--icon-sm)',
  md: 'size-(--icon-md)',
  lg: 'size-(--icon-lg)',
  xl: 'size-(--icon-xl)',
} as const satisfies Readonly<Record<IconSize, string>>;

export interface IconProps extends Omit<
  ComponentProps<'svg'>,
  'children' | 'viewBox' | 'role' | 'aria-label'
> {
  name: IconName;
  size?: IconSize;
  /**
   * The word a screen reader hears. Absent — the usual case — the glyph is
   * decoration and is hidden from the accessibility tree entirely.
   */
  label?: string;
}

export function Icon({ name, size = 'md', label, className, ...rest }: IconProps): ReactElement {
  const { isRtl } = useDirection();
  const definition = ICON_GLYPHS[name];
  const glyph = glyphFor(definition, isRtl);

  return (
    <svg
      {...rest}
      viewBox={ICON_VIEWBOX}
      className={cn('shrink-0', iconSizeClasses[size], className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-icon={name}
      // Stated so a test can tell a glyph that was chosen from the reading
      // direction apart from one that merely happens to look symmetric.
      data-directional={isDirectionalGlyph(definition) ? '' : undefined}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {glyph.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
