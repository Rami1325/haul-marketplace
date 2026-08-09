/**
 * ---------------------------------------------------------------------------
 * Space
 * ---------------------------------------------------------------------------
 * A 4px grid, expressed in rem. Both halves of that sentence are decisions.
 *
 * The grid exists so that spacing is chosen from a scale rather than typed as a
 * number. Once one screen uses 14px and another uses 15px, nothing in the
 * product lines up and no reviewer can tell whether a given gap is deliberate.
 * The scale thins out above 24px because large gaps are structural — the room
 * between two cards, the padding of a sheet — and there is no design question
 * that needs both 68px and 72px.
 *
 * rem rather than px because the plan promises dynamic type, and a layout whose
 * text grows while its gutters stay fixed does not get more readable, it gets
 * cramped. Spacing has to grow with the text it separates.
 *
 * The px map is carried alongside for React Native, which takes numbers and has
 * no rem. The two are asserted equivalent by test rather than derived from one
 * another, because a token file that reads as a table is worth more than one
 * that reads as a transformation.
 * ---------------------------------------------------------------------------
 */

export const space = {
  '0': '0',
  '1': '0.25rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '7': '1.75rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
  '20': '5rem',
  '24': '6rem',
} as const;

export type SpaceToken = keyof typeof space;

export const spacePx = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
  '24': 96,
} as const satisfies Readonly<Record<SpaceToken, number>>;

/**
 * Ordered for generated CSS and for the monotonicity test. Object key order is
 * reliable for integer-like keys, but relying on that in a build artefact is the
 * kind of assumption that breaks quietly, so the order is written down.
 */
export const spaceTokens = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '10',
  '12',
  '16',
  '20',
  '24',
] as const satisfies readonly SpaceToken[];
