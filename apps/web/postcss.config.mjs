/**
 * Tailwind v4 is a PostCSS plugin and nothing else — no `tailwind.config.js`,
 * no autoprefixer. The design tokens live in `packages/ui/src/tokens/*.ts`, are
 * generated into `@haul/ui/theme.css`, and reach this app through the single
 * `@import` in `src/app/globals.css`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
