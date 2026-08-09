import { cn, type ClassValue } from './cn.js';

/**
 * ---------------------------------------------------------------------------
 * variants — a typed class recipe
 * ---------------------------------------------------------------------------
 * Written rather than imported. `class-variance-authority` does this job in
 * about the same number of lines, but a design system's variant helper is the
 * one dependency that touches every component's public type signature, and
 * owning ~40 lines is cheaper than owning somebody else's API surface for the
 * life of the product.
 *
 * The types are the point. `defaults` must name a real option for every
 * variant, and a caller passing `size="huge"` fails to compile rather than
 * silently rendering an unstyled button.
 * ---------------------------------------------------------------------------
 */

type VariantOptions = Record<string, string>;
type VariantConfig = Record<string, VariantOptions>;

/** `{ size: 'sm' | 'md', tone: 'route' | 'ghost' }` derived from the config. */
export type VariantProps<V extends VariantConfig> = {
  [K in keyof V]?: keyof V[K] & string;
};

type RequiredVariantProps<V extends VariantConfig> = {
  [K in keyof V]: keyof V[K] & string;
};

export interface VariantRecipe<V extends VariantConfig> {
  /** Classes applied to every instance. */
  base: ClassValue;
  variants: V;
  /** Every variant needs a default — there is no "unset" rendering. */
  defaults: RequiredVariantProps<V>;
  /**
   * Classes that apply only when several variants coincide. A ghost button
   * needs a different disabled treatment than a filled one, and encoding that
   * as a third tone would multiply the matrix instead of describing it.
   */
  compound?: ReadonlyArray<{
    when: VariantProps<V>;
    use: ClassValue;
  }>;
}

export type VariantFn<V extends VariantConfig> = ((
  props?: VariantProps<V> & { className?: ClassValue },
) => string) & {
  /**
   * The recipe that produced this function, kept reachable on purpose.
   *
   * `__tests__/tailwind.test.ts` walks every recipe's full cartesian product and
   * compiles the result, which is what proves each class a component can render
   * actually has CSS behind it. Enumerating that matrix from a hand-written list
   * in the test would mean a variant added here is a variant the test silently
   * stops covering — the failure mode that check exists to prevent.
   */
  readonly recipe: VariantRecipe<V>;
};

export function variants<const V extends VariantConfig>(recipe: VariantRecipe<V>): VariantFn<V> {
  const keys = Object.keys(recipe.variants) as Array<keyof V & string>;

  const fn: VariantFn<V> = Object.assign(
    (props: (VariantProps<V> & { className?: ClassValue }) | undefined = {}) => {
      // Narrowed rather than destructured: `{ className, ...rest }` produces an
      // `Omit<…>` that TypeScript no longer relates to `VariantProps<V>`, because
      // a caller could in principle name a variant "className". An intersection is
      // always assignable to its own member, so reading through this alias keeps
      // the lookup honest without an `unknown` laundering step.
      const selected = props as VariantProps<V>;

      const resolved = {} as RequiredVariantProps<V>;
      for (const key of keys) {
        resolved[key] = selected[key] ?? recipe.defaults[key];
      }

      const chosen: ClassValue[] = [recipe.base];
      for (const key of keys) {
        const group = recipe.variants[key];
        // `noUncheckedIndexedAccess`: both lookups are total by construction —
        // `key` comes from `Object.keys(recipe.variants)` and `resolved[key]` is
        // either a caller value the type system checked or the declared default.
        if (group) chosen.push(group[resolved[key]]);
      }

      for (const rule of recipe.compound ?? []) {
        const matches = (Object.keys(rule.when) as Array<keyof V & string>).every(
          (key) => rule.when[key] === resolved[key],
        );
        if (matches) chosen.push(rule.use);
      }

      chosen.push(props.className);
      return cn(chosen);
    },
    { recipe },
  );

  return fn;
}
