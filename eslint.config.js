import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ---------------------------------------------------------------------------
 * ESLint — the rules the compiler cannot state
 * ---------------------------------------------------------------------------
 * `tsconfig.base.json` already refuses most of what could go wrong in this
 * repo. Strict mode, `noUncheckedIndexedAccess`, `noUnusedLocals` and
 * `verbatimModuleSyntax` between them cover the entire class of mistake that
 * linters were invented for, so this config deliberately does not re-litigate
 * them. What is left is the short list of conventions that hold a monorepo of
 * seven packages together and that nothing else checks — and every one of them
 * fails in somebody else's package rather than in the one where it was written,
 * which is exactly the kind of mistake a human reviewer stops catching.
 *
 * The load-bearing rule is the `.js` extension on relative imports. Packages
 * here are consumed as source TypeScript with no build step, and
 * `moduleResolution: "Bundler"` happily type-checks an extensionless import
 * that Node's ESM resolver then refuses to load. The compiler is silent, the
 * bundlers are silent, and the failure surfaces in whichever app imports the
 * package first. So the extension is enforced here, where it is cheap.
 *
 * Formatting is Prettier's job and is not duplicated. A stylistic rule in this
 * file is a rule that will eventually disagree with `.prettierrc.json`, and the
 * argument it starts is never worth what it saves.
 * ---------------------------------------------------------------------------
 */

/**
 * Relative specifiers that do not end in a real file extension. Written as a
 * negative lookahead rather than a lookbehind so the error message can name the
 * whole import, and kept to the extensions this repo actually imports —
 * widening it later should be a deliberate decision, not an accident.
 *
 * `.mjs` and `.cjs` are here because the rule's intent is "no extensionless
 * relative import", not "every import ends in .js". A `.mts` source is imported
 * as `.mjs`, which is what the theme-CSS generator's test does; rejecting it
 * demanded an extension the runtime would not resolve.
 */
const RELATIVE_IMPORT_WITHOUT_EXTENSION = '^\\.{1,2}/(?!.*\\.(?:js|mjs|cjs|jsx|json|css|svg)$)';

export default tseslint.config(
  {
    name: 'haul/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Drizzle writes these; they are a generated record of what has already
      // been applied to a database, not source we are free to change.
      'packages/db/migrations/**',
      // Committed agent output, kept verbatim so the catalog derivation stays
      // reproducible. Linting it would invite editing it.
      'packages/config/src/data/**',
      // Written by `next build`, and it references its own generated route
      // tables as `./.next/types/routes.d.ts` — a relative import with a `.ts`
      // extension, which is precisely what the rule below forbids. Widening that
      // rule to admit `.ts` would retire the one check that keeps this repo's
      // packages loadable by Node, in exchange for a file we do not write.
      '**/next-env.d.ts',
    ],
  },

  {
    name: 'haul/base',
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    linterOptions: {
      // An `eslint-disable` that no longer suppresses anything is a comment
      // asserting a danger that has already been removed. Those mislead.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // A zero-width or non-breaking character is a real bug in code and a
      // deliberate choice inside a template. `payout.ts` emits a UTF-8 BOM so
      // Excel on a Hebrew Windows machine opens a payout CSV without mangling
      // driver names, and Hebrew strings legitimately carry directional marks.
      'no-irregular-whitespace': ['error', { skipTemplates: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: RELATIVE_IMPORT_WITHOUT_EXTENSION,
              message:
                'Relative imports need an explicit .js extension — packages are consumed as source ESM and Node will not resolve this at runtime.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'haul/typescript',
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommended],
    rules: {
      // `verbatimModuleSyntax` erases nothing it is not told to erase, so an
      // unmarked type import becomes a real runtime import of a module that may
      // only exist at compile time. The house style marks them; this checks it.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // The compiler already reports unused locals and parameters, and it does
      // it with better placement. Leaving both on means two errors per mistake.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  {
    name: 'haul/product-source',
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    // `migrate` and `seed` are command-line entry points whose entire output is
    // the terminal. Everything else under `packages/*/src` is library code that
    // does not know whether it is running on a server, in a browser tab or on a
    // driver's phone, so it has no business writing to a console it cannot see.
    // An app is worse, not better: a `console.log` there runs on a customer's
    // device or in a production server log, and the one under `apps/web` would
    // be printing an address or a price into whatever is collecting stdout.
    ignores: ['packages/db/src/migrate.ts', 'packages/db/src/seed.ts'],
    rules: {
      'no-console': 'error',
    },
  },

  /**
   * Type-aware linting, scoped to `src`. `projectService` resolves each file
   * against the nearest tsconfig, which works cleanly for package and app
   * sources alike because every one of those tsconfigs includes `src/**`. Build
   * scripts and config files sit outside those includes, so they get syntax-only
   * linting below rather than an out-of-project error — the alternative is a
   * second tsconfig per package that exists only to satisfy the linter.
   *
   * The rule set is deliberately small. The full `recommendedTypeChecked`
   * preset spends most of its budget on `no-unsafe-*`, which in a Zod- and
   * Drizzle-heavy codebase reports the library boundary rather than a defect.
   * These four are the ones that catch bugs a reviewer would miss: a promise
   * nobody waited for, an `await` on a value that was never a promise, an
   * async function passed where a synchronous one was expected, and a thrown
   * value with no stack trace attached.
   */
  {
    name: 'haul/typescript-type-aware',
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
    },
  },

  /**
   * The two places React is written. `react-hooks` v7 is the whole React
   * Compiler rule set, which is the reason to have it: it rejects the mutations
   * and conditional hook calls that make a component render correctly today and
   * incorrectly the moment the compiler memoises it.
   *
   * From `eslint-plugin-react` only the rules that describe real defects are
   * enabled. Its `recommended` preset is built for a JavaScript codebase and
   * spends itself on `prop-types` and `display-name`, both of which TypeScript
   * already answers. `jsx-key` is the one it has that nothing else does, and a
   * missing key is a rendering bug that survives every type check.
   *
   * The rule set is shared between the design system and the app rather than
   * relaxed for the app. A component in `apps/web` is not held to a lower
   * standard than one in `packages/ui` because of where the file happens to
   * sit — the customer meets both of them on the same screen. The one rule the
   * app has needed to step around so far is `react/no-danger`, for the inline
   * theme script that has to run before first paint, and it steps around it at
   * the line with a reason attached rather than by leaving the rule off here.
   */
  {
    name: 'haul/react',
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    plugins: { react },
    // The React version is stated rather than detected on purpose.
    // `eslint-plugin-react` still declares a peer range that stops at ESLint 9,
    // and its auto-detection calls `context.getFilename()`, which ESLint 10
    // removed — detection crashes the run outright. Naming the version skips
    // that code path entirely. Revisit when the plugin ships ESLint 10 support.
    settings: { react: { version: '19.2' } },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/jsx-no-target-blank': 'error',
      'react/no-array-index-key': 'error',
      'react/no-danger': 'error',
      'react/no-unstable-nested-components': 'error',
    },
  },

  {
    name: 'haul/tooling',
    files: ['*.js', '*.mjs', '**/scripts/**', '**/*.config.{ts,mts,js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      // `calibrate.mts` re-fits the rate card by walking raw JSON and a numeric
      // grid. It is a workbench, not a shipped module, and demanding types for
      // a scratch search space would only produce types nobody reads.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
