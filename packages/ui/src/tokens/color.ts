/**
 * ---------------------------------------------------------------------------
 * Colour
 * ---------------------------------------------------------------------------
 * HAUL has exactly one palette and this is it. Tailwind's `@theme` block, the
 * NativeWind config and every component read from these two objects, because a
 * design system with two colour sources eventually ships a primary button whose
 * web and native greens differ by a few percent — and the one thing a moving
 * company cannot afford to look is improvised.
 *
 * The direction is road signage, not fintech: interstate guide-sign green as
 * the primary, hi-vis amber reserved strictly for money and warnings, and
 * asphalt neutrals carrying a green bias so nothing reads as default grey.
 *
 * The palette already knows something worth preserving: **amber is split into a
 * text tone and a fill tone.** They are not two shades of one colour, they are
 * two jobs. Collapsing them into a single `amber` is the change that silently
 * breaks contrast on every money figure in the product.
 *
 * The two themes declare identical keys. That is enforced twice — by `satisfies`
 * at compile time and by a test at run time — because a token present in one
 * theme and absent from the other is not a styling bug. It is an element that
 * disappears into its own ground, and it disappears only for the half of the
 * users on the other theme, which is the half nobody screenshots.
 *
 * ## Dark is not light inverted
 *
 * The driver app is read in a truck cab at night by someone who is about to
 * drive. Every dark value below answers to that.
 *
 * **Nothing is black.** A true-black ground makes light text bloom on OLED and
 * wrecks the dark adaptation of a driver who has to look at the road ten
 * seconds later. `paper` is asphalt (#121917) carrying the same green bias as
 * the light neutrals, sitting above Material's #121212 floor rather than at it.
 * `card` is lighter than `paper` because a raised surface catches light, and
 * `paper2` is darker because recessed means recessed in both themes. `paper2`
 * is inset-only — progress tracks, disabled fields, table stripes — never the
 * ground behind a screen of body text, which is what keeps the darkest token
 * clear of the halation argument.
 *
 * **`ink` is #E4E9E4, not #FFF**, and green-biased so the neutrals never read as
 * default grey. It lands at 14.51:1 against light mode's 15.74:1, so the themes
 * feel like one product rather than one being harsher. That choice is not free
 * and it is on the record here: it costs contrast headroom, and it is precisely
 * why the amber fill cannot also carry a 3:1 boundary in dark mode. It is still
 * the correct trade — halation is a nightly physical problem, the fill boundary
 * has a clean workaround.
 *
 * **The guide green had to move.** #10574A on #121917 is 2.02:1; it does not
 * merely lose contrast, it vanishes into the asphalt, because the two are
 * neighbours on the same axis. No adjustment to the ground rescues it, so the
 * primary itself changes: hue 166 against the original 169, lifted in lightness
 * with chroma pulled back so it still reads as signage green rather than mint.
 *
 * The consequence is a **polarity flip on the primary button**: light mode is a
 * dark green ground under a near-paper label, dark mode is a light green ground
 * under a near-asphalt label. So `onRoute` inverts too — and note the symmetry
 * that survives: in both themes the button's foreground is *the theme's opposite
 * ground*, never an invented value.
 *
 * **`routeDeep` keeps its name because its meaning is unchanged.** "Deep" means
 * further from the ground, not darker. In light that is darker; in dark, pressing
 * to a darker green would move the button back toward the surface it sits on,
 * which reads as disabled rather than engaged, so it lightens instead. The
 * invariant that matters survives the flip: pressing always *raises* the label's
 * contrast. Asserted, not assumed.
 *
 * **The two ambers swap jobs, exactly and for a reason.** What forced the split
 * in the first place was the ground: the text tone is always the one compensated
 * away from the ground, the fill tone is always the one that carries the theme's
 * ink. So light is {text = darkened, fill = true Hi-Vis} and dark is the reverse.
 * It is nearly the exact mirror and the near-miss is instructive — the exact
 * mirror would make the dark fill #8A6408, on which dark ink measures 4.37:1,
 * short of AA by 0.13. The fill drops two steps instead. That was not rounded up.
 *
 * The bright amber block does not survive into dark mode at all. #E8B33A as an
 * area on this ground is roughly nine times the page luminance — a floodlight in
 * front of a driver at night, and the fastest way to break the rule that amber
 * means money or attention and nothing else, because the eye would go there
 * regardless of what the block said. In dark mode amber is carried by text and
 * by hairline, never by area.
 *
 * **`rust` and `hivis` are kept far apart in hue** (roughly 12 against 40 in both
 * themes). Both are warm, both are read at a glance under stress, and if error
 * and money converge a driver reads a failure as a payout.
 *
 * Six pairings cannot reach AA. None of them was fudged and none is omitted:
 * each is asserted as a known exception in `__tests__/contrast.test.ts` next to
 * the substitute the system uses instead.
 * ---------------------------------------------------------------------------
 */

/**
 * Lifted from `PLAN.html`'s own `:root` — the rendered proposal is the
 * specification, so these hex values are quoted rather than re-derived.
 */
export const lightColors = {
  paper: '#F0F1EC',
  paper2: '#E6E8E1',
  card: '#FBFBF7',
  ink: '#14181A',
  ink2: '#3E4845',
  ink3: '#6C7470',
  line: '#D3D7CE',
  line2: '#BFC4B9',
  route: '#10574A',
  routeDeep: '#0B4239',
  onRoute: '#F2F4EE',
  /** Amber TEXT. Darkened off the brand fill until it clears AA on paper. */
  hivis: '#8A6408',
  /** Amber FILL. The true Hi-Vis. Never used as text — see the banned pairing. */
  hivisFill: '#E8B33A',
  rust: '#A8452E',
  rustSoft: '#F0DED8',
} as const;

export type ColorToken = keyof typeof lightColors;

/** One theme's worth of values. Both themes conform; so does any future theme. */
export type ColorScale = Readonly<Record<ColorToken, string>>;

export const darkColors = {
  paper: '#121917',
  /** Inset only. Darker than `paper` because recessed means recessed in both themes. */
  paper2: '#0B100F',
  card: '#1A2220',
  ink: '#E4E9E4',
  ink2: '#A9B3AD',
  ink3: '#808B85',
  line: '#232B28',
  line2: '#333D39',
  route: '#35A98F',
  /** Lighter than `route`, because deep means further from the ground. */
  routeDeep: '#4EBEA3',
  /** An asphalt tone: the theme's opposite ground, mirroring light's paper tone. */
  onRoute: '#08100E',
  /** Amber TEXT — one step off the brand fill, which blooms on OLED at full chroma. */
  hivis: '#E0A93F',
  /** Amber FILL, now the deep tone. The bright block does not survive into dark. */
  hivisFill: '#7A5807',
  rust: '#E5836A',
  rustSoft: '#3A1B14',
} as const satisfies ColorScale;

/**
 * The CSS custom-property and Tailwind utility name for each token. Written out
 * rather than produced by a camel-to-kebab function so that the generated
 * stylesheet's surface is greppable: `bg-hivis-fill` should lead back here.
 */
export const colorCssNames = {
  paper: 'paper',
  paper2: 'paper-2',
  card: 'card',
  ink: 'ink',
  ink2: 'ink-2',
  ink3: 'ink-3',
  line: 'line',
  line2: 'line-2',
  route: 'route',
  routeDeep: 'route-deep',
  onRoute: 'on-route',
  hivis: 'hivis',
  hivisFill: 'hivis-fill',
  rust: 'rust',
  rustSoft: 'rust-soft',
} as const satisfies ColorScale;

/**
 * Declaration order for generated CSS. Fixed so that a stylesheet rebuilt from
 * unchanged tokens produces a byte-identical file and a diff means something.
 */
export const colorTokens = [
  'paper',
  'paper2',
  'card',
  'ink',
  'ink2',
  'ink3',
  'line',
  'line2',
  'route',
  'routeDeep',
  'onRoute',
  'hivis',
  'hivisFill',
  'rust',
  'rustSoft',
] as const satisfies readonly ColorToken[];

export const colorThemes = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof colorThemes;
