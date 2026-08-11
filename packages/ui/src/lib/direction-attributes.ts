import { directionFor, type Locale, type TextDirection } from '@haul/types';

/**
 * ---------------------------------------------------------------------------
 * The attributes a host document has to carry
 * ---------------------------------------------------------------------------
 * `dir` and `lang`, derived from the locale, for whoever renders `<html>`.
 *
 * **This lives in `lib/` rather than beside the provider, and the reason is the
 * whole point of the module.** It used to sit in `components/direction.tsx`,
 * exported next to `DirectionProvider` with a comment saying it was separated
 * out precisely so a Next.js app root could put the pair on `<html>`. That file
 * carries `'use client'` — it must, it creates a context at module scope — and
 * a `'use client'` directive marks the *module*, not the components in it. Every
 * export of a client module becomes a client reference, so the one function
 * written for a server root layout was the one function a server root layout
 * could not call:
 *
 *     Attempted to call directionAttributes() from the server but
 *     directionAttributes is on the client.
 *
 * It is the same shape as the bug that put `'use client'` on `direction.tsx` in
 * the first place, one level in: not a component that fails to render on the
 * server, but a helper that cannot be *called* there. It surfaced the first time
 * an app actually rendered `<html>`, because nothing in this package has a
 * server to fail on — `__tests__/use-client.test.ts` proves a module carries the
 * directive when it needs one, and had no way to notice that a directive can
 * also strand a plain function.
 *
 * A Server Component cannot re-derive this by hand either: `dir` from a locale
 * is one decision, it belongs to the design system, and an app writing
 * `dir={locale === 'he' ? 'rtl' : 'ltr'}` is the second place that has to learn
 * about Arabic. So the derivation moves to a module with no directive on it, and
 * the direction context stays where it was.
 *
 * The answer itself comes from `@haul/types`, not from here. React Native has no
 * DOM and no `dir` attribute at all, so this is the web's half of a decision
 * `directionFor` owns for every surface.
 * ---------------------------------------------------------------------------
 */
export function directionAttributes(locale: Locale): { dir: TextDirection; lang: Locale } {
  return { dir: directionFor(locale), lang: locale };
}
