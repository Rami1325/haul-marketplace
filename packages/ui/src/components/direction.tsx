'use client';

import { DEFAULT_LOCALE, directionFor, type Locale, type TextDirection } from '@haul/types';
import { createContext, useContext, useMemo, type ComponentProps, type ReactElement } from 'react';
import { cn } from '../lib/cn.js';

/**
 * ---------------------------------------------------------------------------
 * Direction
 * ---------------------------------------------------------------------------
 * Logical properties resolve against the document, not against React. A
 * component that reads `he` out of a context and then styles itself with
 * inline-start padding still lays out the wrong way round if nothing above it
 * carries `dir`, because the browser was never told which way the text runs. So
 * this provider does two jobs that must not be separated: it publishes the
 * locale to the tree, and it puts `dir` and `lang` on a real element. Splitting
 * them is exactly how a design system ends up with an RTL context and an LTR
 * layout, which looks correct in every unit test and wrong on every screen.
 *
 * The locale and the direction come from `@haul/types` rather than being
 * decided again here. There is one answer to "which way does `he` read" and it
 * lives next to the schema that validates the locale in the first place; a
 * second copy in the design system is a second thing to get wrong when Arabic
 * or Russian is added.
 *
 * **Nobody wrapping anything still means Hebrew and RTL.** The context default
 * is not `null` and this deliberately does not throw. A hook that throws
 * outside a provider makes English the path of least resistance — the quickest
 * way to get a component rendering in a test or a story is to leave the
 * provider off, and if that path produced an LTR layout then LTR is what would
 * get reviewed. The default has to be the product's real default or it is not
 * a default at all.
 *
 * The wrapper is `display: contents`, so the provider does not appear in the
 * box tree. Direction and language are inherited attributes and do not need a
 * box to work, and a provider that silently introduced a block into the middle
 * of a flex row would be a layout bug you cannot see in the JSX. Callers that
 * want a real element pass a display class; `cn` resolves the conflict.
 *
 * Nesting is the whole point of the `locale` prop. A Latin-script driver name,
 * an English street address or an invoice rendered for a foreign client is a
 * subtree with its own direction — that is a provider, not a conditional.
 *
 * **`'use client'` is at the top of this file and it is not a formality.**
 * `createContext` runs at module scope, and a React Server Component cannot
 * evaluate that module at all — so without the directive this file throws
 * during the server render. It is re-exported from the barrel, which means the
 * throw is not confined to whoever wanted a direction: any `import … from
 * '@haul/ui'` inside an RSC pulls this module in and takes the server build down
 * with it. That is the whole difference between a component that is unavailable
 * on the server and a package that is. The rule is asserted structurally in
 * `__tests__/use-client.test.ts` rather than left to whoever adds the next hook.
 * ---------------------------------------------------------------------------
 */

export interface DirectionContextValue {
  readonly locale: Locale;
  readonly direction: TextDirection;
  /**
   * Carried rather than re-derived at each call site. The rare component that
   * legitimately branches — a chevron that must point along the reading
   * direction, a swipe gesture — should read one boolean, not repeat the
   * comparison and eventually get it backwards in one place.
   */
  readonly isRtl: boolean;
}

export function directionValueFor(locale: Locale): DirectionContextValue {
  const direction = directionFor(locale);
  return { locale, direction, isRtl: direction === 'rtl' };
}

/** Hebrew, RTL. What every component gets when no provider is above it. */
export const DEFAULT_DIRECTION: DirectionContextValue = directionValueFor(DEFAULT_LOCALE);

const DirectionContext = createContext<DirectionContextValue>(DEFAULT_DIRECTION);

export function useDirection(): DirectionContextValue {
  return useContext(DirectionContext);
}

/**
 * The `<html>` attributes live in `../lib/direction-attributes.js`, not here.
 * They are the half of this module a *server* root layout calls, and `'use
 * client'` marks a module rather than a component — every export of this file is
 * a client reference, so a plain function declared here cannot be invoked during
 * a server render at all. See that file; the move is the fix, not a tidy-up.
 */

export interface DirectionProviderProps extends Omit<ComponentProps<'div'>, 'dir' | 'lang'> {
  locale?: Locale;
}

export function DirectionProvider({
  locale = DEFAULT_LOCALE,
  className,
  children,
  ...rest
}: DirectionProviderProps): ReactElement {
  const value = useMemo(() => directionValueFor(locale), [locale]);

  return (
    <DirectionContext value={value}>
      <div
        dir={value.direction}
        lang={value.locale}
        className={cn('contents', className)}
        {...rest}
      >
        {children}
      </div>
    </DirectionContext>
  );
}
