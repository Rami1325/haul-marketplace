# HAUL — Build Tracking

Single source of truth for what is done and what is not.
Source of scope: the product plan (kept private). Phase 1 = "MVP — the whole loop, one neighbourhood".

**Rule: a task is marked `[x]` the moment it is finished and verified — never in advance, never in a batch at the end.**

| Mark  | Meaning                              |
| ----- | ------------------------------------ |
| `[ ]` | Not started                          |
| `[~]` | In progress                          |
| `[x]` | Done and verified                    |
| `[!]` | Blocked — reason noted inline        |
| `[-]` | Deliberately deferred out of Phase 1 |

---

## Locked decisions

| #   | Decision           | Answer                                                                                               | Date                                         |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | First market       | **Israel** — one metro, then one neighbourhood cluster inside it                                     | 2026-08-08                                   |
| 2   | Data layer         | **Postgres + PostGIS** (Drizzle ORM)                                                                 | 2026-08-08                                   |
| 3   | Build order        | **Foundation → web → mobile**                                                                        | 2026-08-08                                   |
| 4   | Pricing model      | **Locked price** with a tight, pre-disclosed adjustment list                                         | 2026-08-08 (plan §13 rec)                    |
| 6   | Palette            | **Guide Green** `#10574A` + Hi-Vis `#E8B33A`                                                         | 2026-08-08 (plan §13 rec)                    |
| 7   | Primary locale     | **Hebrew, RTL**; English secondary                                                                   | 2026-08-08 (assumption — see Open Questions) |
| 8   | Currency           | **ILS**, stored in **agorot** (integer minor units), displayed **VAT-inclusive**                     | 2026-08-08                                   |
| 9   | Distance           | **Kilometres**, via routing API (not straight-line)                                                  | 2026-08-08                                   |
| 10  | Acquiring PSP      | **PayPlus or HYP** — not Stripe. Behind a provider interface; final choice still open                | 2026-08-08                                   |
| 11  | Scheduled-job auth | **Tokenise at booking, place the J5 hold at T-24h** — local holds don't survive a two-week lead time | 2026-08-08                                   |
| 12  | Payout rail        | **Ops-exported batch → bank portal**; automate (Masav/API) once driver count justifies it            | 2026-08-08                                   |

### Israel-specific deltas from the original plan

The plan was written against a US/EU market. These are the deliberate divergences:

- [x] **Crane / מנוף** is a first-class access input and pricing line — not in the original plan. Standard practice in Israeli moves where stairwells are too narrow. _(modelled in `access.ts`; assessed with a Hebrew reason string in `crane.ts`; priced by floor band in the Tel Aviv rate card)_
- [x] **Shabbat + חג** scheduling — real candle-lighting and nightfall times from solar position, not a hardcoded clock. See WS-2a.
- [x] **Israeli week**: Sun–Thu are workdays, Fri is short, Sat is Shabbat. Time-factor multipliers keyed to this, not to Sat/Sun.
- [x] **VAT (מע"מ)** modelled explicitly — `addVat`/`extractVat`, net/VAT/gross carried on every breakdown, `VatPayable` ledger account.
- [x] **Background checks**: no Checkr equivalent. Replaced with תעודת יושר / police clearance upload + manual review.
- [x] **Payment provider abstraction** — and it turned out to be bigger than a swapped adapter. See WS-8.
- [x] **Acquiring and payout are two separate rails.** No Israeli PSP offers marketplace payouts, so no vendor knows what a driver is owed — the ledger is the system of record, not a reconciliation aid.
- [x] **Israeli bank triplet** (bank / branch / account + תעודת זהות) with check-digit validation, not IBAN.
- [x] **Address model** carries `entrance` (כניסה) and `apartment` — Israeli buildings routinely need both.
- [x] **Elevator is not a boolean** — `none / small / standard / service`. A מעלית קטנה takes people, not sofas; "has elevator: yes" is the lie that costs an hour of stair-carrying.
- [x] **Presets named in Israeli convention** — apartments counted by total rooms (דירת 3 חדרים), not by bedrooms.
- [x] **The type pairing is a Hebrew decision, not a translated one.** The plan's DIN-plus-serif
      brief has no Hebrew glyphs at all, and the face every Israeli product reaches for by default
      (Assistant) cannot align a column of prices. See WS-4.

---

## WS-0 · Foundation

- [x] Monorepo scaffold — pnpm workspaces + Turborepo
- [x] `tsconfig.base.json` — strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- [x] Root lint / format / typecheck pipeline — Prettier, ESLint 9 flat config, Turbo `typecheck`/`test`
- [x] `.gitignore`, `.gitattributes`, `.env.example`, `README.md`
- [x] `git init` + first commit
- [x] Docker Compose: Postgres 16 + PostGIS 3.4, Redis 7 — both verified healthy
- [x] CI workflow (format, lint, typecheck, test, build) — **unverified until a first push**
- [x] `.prettierignore` — generated artifacts are out of scope for the formatter, because
      `theme.css` is checked byte-for-byte against its generator and a Prettier upgrade
      would otherwise read as a broken design system

**Stack pinned:** Node 24 · pnpm 11 · TypeScript 5.9 · Vitest 4 · Turbo 2.10 · Zod 4 · Next 16 · React 19.
TypeScript 7 (native) is available but the tooling peers still target 5.x — revisit after Phase 1.

**Packages consume source TypeScript directly** (no per-package build step). Next `transpilePackages`,
Metro, and Vitest all handle it, and it removes a whole class of stale-`dist` bugs.

## WS-1 · Domain contracts — `packages/types`

- [x] Money primitive (agorot, integer-only, no float arithmetic anywhere)
- [x] Israeli locale primitives: phone `+972`, ILS, km, Jerusalem-time day helpers
- [x] `Address` schema — street, number, entrance, apartment, city, postcode, lat/lng
- [x] `AccessDetails` schema — floor, elevator kind, stair flights, carry distance, parking, **crane**, permit
- [x] `CatalogItem` + `ManifestLine` + `Manifest` + `ManifestPreset` schemas
- [x] `VehicleClass` schema — m³, payload kg, bay dimensions, vehicle height, licence category
- [x] `Quote` schema — locked total, itemised breakdown, expiry, engine + rate-card version, input hash
- [x] `Job` schema — multi-stop, schedule, proof photos, full timeline, `actualWorkingMinutes`
- [x] `JobState` machine — 13 states incl. `scheduled`, `expired`, `no_match`, `cancelled`
- [x] State machine transition table + guards (who may advance each edge)
- [x] `Driver`, `Vehicle`, `DriverDocument` schemas with expiry tracking + `canReceiveOffers`
- [x] `Offer` schema — payout, manifest, access, countdown, wave
- [x] Double-entry `LedgerTransaction` — balances-to-zero enforced in the schema
- [x] `Adjustment` schema — the only four things that may change a locked price
- [x] Unit tests — **50 passing**: money arithmetic, VAT, allocation, every legal and illegal transition

**Verified structural invariants** (these are tests, not comments):

- `(from, event, actor)` resolves to exactly one transition — the machine cannot be non-deterministic
- Walking **every simple path** from `quoted`: no route authorizes twice, no route takes the customer's money twice, and no route captures without authorizing first
- Every non-terminal state has an exit; every terminal state has none; every state is reachable from `quoted`
- Ops can act on every non-terminal state — no state where a human ends up in the database instead
- `CancelBeforeMatch` structurally does not exist once a driver has committed, so a free cancel after accept is impossible by construction
- Capture is blocked while any adjustment is unapproved — the price lock's load-bearing guard

## WS-2a · Israeli operating calendar — `packages/calendar`

Answers one question: _can we send a truck now, and if not, when next?_

- [x] Hebrew calendar arithmetic — Gregorian ↔ fixed ↔ Hebrew, molad + all dehiyot
- [x] Solar position — sunrise/sunset, candle lighting, nightfall (צאת הכוכבים)
- [x] Yom tov table (Israel keeps one day, not the diaspora's two)
- [x] Chol HaMoed detection — a demand **spike**, not a holiday
- [x] Yom Ha'atzmaut / Yom HaZikaron with the post-2004 postponement rules
- [x] Tisha B'Av and Purim
- [x] Day classification → `DayKind` (Workday / ShortDay / Shabbat / HolidayEve / Holiday)
- [x] Restricted periods run **sunset→nightfall**, with consecutive days merged
- [x] `dispatchWindowsFor()` — operating hours minus restrictions minus pre-Shabbat cushion
- [x] Jerusalem wall-clock ↔ UTC, DST-correct via `Intl` (no hardcoded Knesset rules)
- [x] **38 tests** — including a 200-year daily round-trip and legal-year-length checks

**Written, not imported.** Every Hebrew-calendar package on npm is GPL-2.0 or LGPL —
copyleft, and wrong to link into a proprietary product. The arithmetic is a publicly
specified fixed algorithm, so owning it costs ~200 lines and removes the licence question.

**Two findings worth keeping:**

- _Motzei Shabbat is prime moving time._ Treating Saturday as a dead day throws away one of
  the busiest windows of the week. Default close moved 21:00 → 22:00 because in midsummer
  Shabbat does not end until ~20:15.
- _Chol HaMoed is the opposite of a holiday here._ The country is off work for a week and a
  lot of people move house. Pricing should treat it as peak demand.

## WS-2 · Pricing engine — `packages/pricing`

Pure module. Runs client-side for preview, server-side as the only authority. Same code, no drift.

- [x] City rate-card config shape — every tunable value, editable per city without a deploy
- [x] `validateRateCard()` — rejects take rates outside 15–25%, surge-looking caps, thin buffers
- [x] `estimateWorkingMinutes()` — handling, stairs, lift, carry, parking, crane, crew scaling, buffer
- [x] Sublinear crew scaling `(2/crew)^0.8` — three movers are not a third faster; they queue on the stairs
- [x] Crane (מנוף) assessment + pricing, with a **Hebrew reason string** so it is never silently applied
- [x] Distance component via routed distance, with included-km allowance
- [x] Access component — per flight, long carry beyond a free allowance, difficult parking, extra stops
- [x] Heavy-item surcharges — piano, safe, treadmill
- [x] Time factor — Israeli week, chol hamoed, evening
- [x] Demand factor — soft-capped, folded into one line, **never labelled surge** (asserted by test)
- [x] VAT computation, quoted inclusive
- [x] Protection tier pricing
- [x] Promo application
- [x] Driver payout — guaranteed ₪ figure on the **undiscounted** fare
- [x] Minimum fare floor + gross rounding to a clean figure, absorbed by an explicit line
- [x] `stableHash()` of every pricing input, recorded on the quote so any price can be explained later
- [x] Determinism tests — identical inputs give an identical price and hash; every priced input changes it
- [x] Property tests — breakdown always sums, never negative, never below floor, monotonic in items/distance/floors
- [x] **58 tests passing**
- [x] Crane pricing rebuilt as **floor bands** with an hourly call-out — the market is banded and discontinuous, not linear per-floor
- [x] **Seasonal factor by month** — the largest single swing in the card
- [x] **Batching efficiency** — the term that was missing entirely (see below)
- [x] Tel Aviv seed rate card, sourced and confidence-labelled per field
- [x] **Calibration tests against real Israeli market prices** — the test that matters most

## WS-2b · Catalog, fleet & rate card — `packages/config`

- [x] **169-item Israeli catalog**, Hebrew-first with search aliases in both languages
- [x] 6 vehicle classes with real dimensions, payloads and **vehicle height** (underground car parks here cap ~200cm, which silently rules out every box truck)
- [x] 7 preset bundles named in Israeli convention (דירת 3 חדרים)
- [x] Tel Aviv rate card with per-field confidence and sources
- [x] `REFUSED_ITEMS` — things we will not carry, with reasons
- [x] Catalog search (Hebrew + English + aliases, common items win ties)
- [x] Reproducible derivation: `scripts/build-catalog.mjs` + raw agent output committed
- [x] `scripts/calibrate.mts` — re-fits the model against market anchors
- [x] **20 calibration tests**
- [x] Pick the ~24 items for the first-screen grid — **derived, not hand-picked**: frequency across
      the 7 presets, tie-broken by category coverage so the grid is not six sofas. Lands on exactly
      24 across appliance / boxes / electronics / furniture. `isCommon` (57) stays, demoted to what
      it always really was — a search-ranking boost, not a screen budget.

**Built by a 10-agent workflow, then repaired.** An adversarial audit agent returned
_"not shippable as a pricing source of truth"_ — correctly. Two independently authored
lists had been merged without reconciliation. What it caught:

- **`craneCandidate` was noise.** Hand-set per row, so a 42kg mattress needed a crane and an
  80kg two-door fridge did not. Crane is the largest single line on an Israeli move, so this
  was the most expensive defect. Now **derived from a rule** (≥0.8m³ or ≥70kg, minus flexible
  items, plus facade-mounted ones). **20 flags changed.**
- **4 of 15 preset item ids did not resolve** — a quarter of the default inventory silently
  vanished from every preset quote. Now fails the build if any id is unresolvable.
- **8 objects existed twice with divergent numbers** — the same coffee table priced 4 or 6
  minutes depending which button the customer tapped.
- **`gas_balloon` (בלון גז) modelled as a routine 5-minute carry.** LPG is dangerous goods and
  goods-in-transit insurers exclude it. Moved to `REFUSED_ITEMS`.
- Missing Israel-specific items: stroller, fan, פלטה, סוכה, מיטה וחצי, ארון שירות — and no
  catch-all "other" row, so anything unlisted was silently dropped from the quote.

**The calibration finding that changed the model.** The engine reconciled perfectly and still
quoted a 5-room move at **₪9,660 against a market of ₪5,000**. Cause: the catalog times each
item as though handled alone, but real crews batch — they carry three boxes at once and
chain-pass down a stairwell. Added a **batching-efficiency term**, then fitted it numerically
against the four sourced apartment totals. Optimum is interior on a wide grid, not a boundary
artefact. **RMS error now 3.3%:**

| Move         | Quoted | Market typical | Ratio |
| ------------ | ------ | -------------- | ----- |
| דירת 2 חדרים | ₪1,890 | ₪1,900         | 0.99× |
| דירת 3 חדרים | ₪2,900 | ₪2,800         | 1.04× |
| דירת 4 חדרים | ₪3,590 | ₪3,800         | 0.94× |
| דירת 5 חדרים | ₪5,000 | ₪5,000         | 1.00× |

**Rate-card confidence is labelled per field.** `longCarryPer10m` is marked **INVENTED** — no
Israeli mover publishes one; they absorb it into billed hours. It is not to be defended to a
customer and is the first thing Phase 0 should replace.

- [ ] Golden-file tests pinned to the real rate card (calibration tests cover this for now)

**Two engine decisions worth remembering:**

- _Multipliers do not touch fixed costs._ Evening demand scales base, distance, labour and access —
  but not the crane call-out or a piano surcharge. Those are a third party's fee and a fixed cost;
  inflating them raises the number with nothing behind it.
- _A crane cancels the stair charge it was booked to avoid._ Billing both is the double-charge that
  ends up in a one-star review. Asserted by test.

## WS-3 · Data layer — `packages/db`

- [x] Drizzle setup + three-phase migration runner (extensions → generated → hand-written SQL)
- [x] PostGIS extension + `pg_trgm`, applied and verified
- [x] Tables: users, saved_addresses, drivers, vehicles, driver_documents
- [x] Tables: jobs, job_stops, job_manifest_lines, quotes, adjustments
- [x] Tables: ledger_transactions, ledger_entries, payment_authorizations, payout_batches, payout_lines
- [x] Tables: offers, dispatch_waves, driver_presence, job_location_trail
- [x] Tables: proof_photos, disputes, ratings
- [x] Tables: cities, rate_cards, promos, promo_redemptions, audit_log, fraud_flags, feature_flags
- [x] **30 tables**, Postgres enums derived from `@haul/types` so the DB cannot hold an unknown job state
- [x] `ST_DWithin` eligible-pool query with scoring, **verified index-assisted by EXPLAIN**
- [x] `countEligibleDrivers()` — answers "coverage problem or supply problem?" after a failed match
- [x] Deterministic seed — city, rate card, 12 drivers, 8 online across the launch cluster
- [x] Money columns are `bigint` agorot with sane-range CHECK constraints
- [x] **17 tests** (integration, against real Postgres; skip cleanly without it)

**Four design decisions worth remembering:**

- **`driver_presence` is separate from `job_location_trail`.** Presence is one small hot row
  per driver that dispatch queries constantly; the trail is append-only history for disputes
  and ETA analytics. Merging them would put a high-write time series in the middle of the
  matching path. The trail uses a BRIN index — it is append-only and time-ordered, which is
  exactly what BRIN is for, and orders of magnitude smaller than the btree at ~300k rows/day.
- **Positions are plain lat/lng doubles with a GENERATED `geography(Point,4326)` column beside
  them.** One writable source of truth, so the spatial index cannot disagree with the numbers
  the application reads.
- **The dispatch GiST index is partial** — `where is_online and not is_busy`. Only a fraction
  of the table is ever a candidate, so the index stays small and hot.
- **Scoring weights idle time at 15%.** Ranking purely on distance and rating lets the top
  three drivers in a neighbourhood take everything, new drivers never get a first job, and
  supply churns. Driver 30-day retention is the best predictor of survival, so fairness is a
  scoring input rather than an afterthought.

**The load-bearing test.** `ST_DWithin` is index-assisted; `ST_Distance(...) < x` is not. They
look equivalent and return identical rows on a seed dataset. Verified at 3,000 drivers:

| Query form             | Plan                                | Cost       |
| ---------------------- | ----------------------------------- | ---------- |
| `ST_DWithin`           | Bitmap Index Scan on the GiST index | **2,191**  |
| `ST_Distance(...) < x` | Seq Scan                            | **37,735** |

17× at 3,000 drivers and widening linearly, so the test loads a realistic pool and asserts the
plan, not just the rows.

**Money invariants are enforced in the database too**, not only in Zod and the posting
functions — those live in application code and a deferred CONSTRAINT TRIGGER does not. Proven:
an unbalanced ledger transaction is rejected at COMMIT; a capture exceeding its authorization
is rejected; so is a job whose window ends before it starts.

## WS-4 · Design system — `packages/ui`

- [x] Token file — single source, Guide Green palette, light + dark
- [x] Tailwind preset (web) + NativeWind config (native) from the same tokens
- [x] RTL-first layout primitives (logical properties, no hardcoded left/right)
- [x] Hebrew + Latin type pairing; tabular figures for all money
- [x] **Price Card** — the signature component (booking, offer, receipt, invoice)
- [x] Button, Input, Sheet, Stepper, Chip, Card primitives
- [x] Motion tokens — 200–280ms, weighted easing, progress not spinners
- [x] 44px minimum targets, WCAG AA contrast check
- [x] RadioGroup, Grid, Progress, Countdown, LiveRegion, Icon — added for WS-5, and here rather
      than in the app because the mobile surfaces need every one of them (see WS-5·0)
- [x] **1,246 tests** — contrast computed in both themes, tap targets resolved through the
      compiled stylesheet, RTL purity scanned across every source file
- [x] Self-host the font files (`@fontsource-variable/*`) — shipped with the app shell in WS-5
- [ ] Storybook or equivalent gallery _(deferred: the components are asserted by test, and a
      gallery with no app around it would be the third place a token gets restated)_

**The tokens are TypeScript; the CSS and the native theme are generated from them.**
Tailwind v4 is CSS-first, so `styles/theme.css` is emitted by `scripts/build-theme-css.mts`
and a test regenerates it in memory and demands byte-identity — a token change with a stale
commit fails the build rather than shipping a stylesheet that disagrees with the source.

**The plan's type brief does not survive Hebrew.** `PLAN.html` asks for a condensed DIN
against a warm serif; neither DIN Condensed nor Charter has a Hebrew glyph, so half the
product would fall back to a system face. Israeli road signage is not DIN either — the
Ministry of Transport specifies Tamrurim and Narkiss Tam for Hebrew, and a Helvetica
derivative for numerals. Hebrew also cannot be condensed the way Latin can: the letters are
square with almost no ascenders, and narrowing them collapses ב/כ and ד/ר exactly when a
sign has to be read fastest. Signage authority therefore comes from weight, not width.

| Role                    | Face          | Why                                                                                |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------- |
| Display + **all money** | Heebo 700–900 | Hebrew by Oded Ezer over Roboto's DIN-adjacent Latin                               |
| Body                    | Rubik         | Softer terminals; Hebrew revised by a native reader; also covers Cyrillic + Arabic |
| Mono                    | Roboto Mono   | Never carries money — it has no ₪ glyph                                            |

All three are SIL OFL 1.1, verified from the npm `license` field _and_ from resolving under
`google/fonts/ofl/` — the same standard that ruled out every GPL Hebrew-calendar package.

**Money is set in Heebo for a structural reason, not a stylistic one.** Verified by parsing
the actual TTFs with fontTools rather than trusting specimens: Heebo ships **no** `tnum`
feature and does not need one — all ten digits already share one advance width at every
weight on the variable axis (1121 at 100, 1176 at 700, 1192 at 900). So a receipt lines up
with no OpenType feature applied, which is what survives React Native on Android and the PDF
path, where features get dropped silently. **Assistant — the default Israeli UI face — was
disqualified**: proportional digits _and_ no `tnum`, so its money cannot be aligned by any
CSS. Alef and Karantina fail identically. Rubik does ship `tnum` and it works, but being
feature-dependent it may never carry a price.

**Amber stays split, as the plan's own palette had it.** `#E8B33A` is the fill; `#8A6408` is
the text tone. Hi-Vis as text on paper is 1.7:1 and unreadable — collapsing the two into one
"amber" is the obvious simplification and it breaks the one colour the product reserves for
money. Amber text on an amber fill fails in both themes (2.80:1 / 3.07:1) and is asserted
against by name, because it is what a Price Card amber chip invites you to reach for.

**Contrast is computed, and the exceptions are usage rules rather than edited hex.** `ink-3`
on paper is 4.23:1 — short of AA for body text — so it is confined to large text and to
non-text boundaries, and secondary running text uses `ink-2` (8.34:1). The rule is enforced
in both themes even though dark `ink-3` clears at 5.05:1, because a component that is AA in
one theme and not the other is a component nobody can reason about.

## WS-5·0 · Prerequisites — the parts of the booking flow that are not the booking flow

Mapping the 11 steps against the shipped packages turned up a list of things the flow needs that
`apps/web` must not own, because `apps/mobile` and the dispatch service need every one of them.
Building them into the app first and extracting later is a merge conflict across every action file.

- [x] `@haul/types` — `quoteSecondsRemaining`; a closed **cancellation vocabulary** (11 codes, bilingual,
      ordered customer → driver → ops) replacing a free-text `reasonCode` no ops console could group by;
      `JobEventSchema` so a server action can parse an event instead of casting one
- [x] `@haul/calendar` — `bookableDaysBetween` / `sliceIntoSlots` / `nextBookableDay`, and Hebrew day
      labels. `dispatchWindowsFor` was the right primitive and the wrong shape for a month grid.
      **`isBookable` is deliberately not `isDispatchable`**: the latter stays true for a Shabbat whose
      motzash tail is too short to actually sell
- [x] `@haul/pricing` — `QuoteInputSchema` (there was no schema to parse an untrusted body against),
      `toQuote`, and `canonicalQuoteInput` so a price can be replayed from its persisted input
- [x] `@haul/config` — `scheduleInputFor` as the **only** sanctioned way to build a `ScheduleInput`;
      `isInServiceArea` (a notice, not a block — the launch boundary is fuzzy and a hard block loses
      bookings we could serve by hand); `isRefusedLabel` so the free-text "other item" field cannot
      smuggle a gas cylinder past `REFUSED_ITEMS`
- [x] `@haul/geo` — **new package.** `PlacesProvider` + `RoutingProvider` behind a `FakeGeoProvider`,
      shaped like `@haul/payments`, so the whole flow develops with no Google key. **89 tests**
- [x] `@haul/contracts` — **new package.** `BookingDraftSchema`, `toQuoteInput`, the request/response
      DTOs and the view models. A draft is partial and invalid by definition — the domain schemas
      cannot represent one — so the draft is built against the _input_ side and `toQuoteInput` is the
      single place it becomes a real, branded, defaulted domain object, or fails loudly. **108 tests**
- [x] `@haul/ui` — the six missing primitives, and `'use client'` on `direction.tsx`, which
      `createContext`s at module scope and is re-exported from the barrel: **any** `import from
'@haul/ui'` in a server component crashed the build. Now asserted structurally
- [x] Self-hosted fonts, `apps/web` scaffold, i18n shell — the first commit of the app itself

**Everything above was audited adversarially before it was committed, and it needed to be.**
Five lenses, each finding then argued against by two independent skeptics; two findings died there.
What survived is below — and the most expensive one was not in any of this new code at all.

## WS-5 · Web — customer booking flow

The 11 steps from plan §05. Amber-edged steps are the differentiators.

- [x] Next.js App Router scaffold, i18n routing (he default, RTL)
- [x] Draft plumbing — `booking_drafts`, the session cookie, the step model, server-side guards,
      and `/book` resuming to the step the customer left off on
- [ ] `01` What are you moving — visual item grid, search, preset bundles
- [ ] `02` Pick items — quantities, always editable _(camera scan deferred to Phase 2)_
- [ ] `03` From & to — Places autocomplete, saved addresses, multi-stop
- [ ] `04` Access details — floor, elevator, stairs, parking, carry, **crane**
- [ ] `05` When — Now / Today / date+window, Shabbat-aware calendar
- [ ] `06` Truck & crew — recommended size pre-selected, capacity in plain language
- [ ] `07` **Price Lock** — one number, breakdown, "what could change this", protection tier
- [ ] `08` Pay — authorize not charge
- [ ] `09` Matching — live notified count, progress not spinner, free cancel
- [ ] `10` Live job sheet — stage, ETA, manifest checklist, photos, chat, add stop
- [ ] `11` Done — itemised receipt matching the locked number, photos, tip, rate, rebook
- [ ] Booking abandonment instrumentation per step

**The scaffold is four files of configuration and three of them are load-bearing in ways
that fail silently.** `apps/web` renders one page on purpose — a Button, a `Money` at
₪1,890.00, Hebrew body text — because the things this commit had to get right are all
invisible to a render test and all visible on that page.

- **The `@source` glob is the design system's lifeline.** pnpm links `@haul/ui` into
  `node_modules` as a symlink and Tailwind's automatic detection never walks
  `node_modules`, so without an explicit `@source` at the real workspace path every class
  the design system renders compiles to nothing. Full `class` attributes, no CSS, and no
  test inside `packages/ui` can see it — from in there the classes compile fine.
  `tailwind.node.test.ts` compiles the app's real stylesheet through the real Tailwind
  resolver and the real Oxide scanner, asserts that utilities existing **only** in
  `packages/ui` came out, then **removes the glob and asserts they disappear**. A positive
  result alone would not prove the glob is what produced it.
- **Test sources are excluded from both globs**, and that is correctness rather than size:
  a suite that proves a physical direction utility gets flagged is full of counter-examples,
  and a scanner cannot tell a fixture from an intention. Left in, an RTL-first product ships
  the exact `padding-left` rules its own test forbids.
- **`@haul/ui/theme.css` already imports `tailwindcss`**, so the app must not. A second
  import emits preflight and the whole utility layer twice and the later copy wins.
  Asserted by counting the imports across the CSS graph, not by reading the file.
- **No i18n library.** The data is already bilingual out of the packages, `@haul/ui` owns
  direction, and Next 16 is too new to bolt a routing library onto. A `[locale]` segment,
  `proxy.ts` for negotiation, and a catalog typed `Messages = typeof he` — so Hebrew is
  structurally authoritative and an English catalog that is missing a key, or carries one
  Hebrew does not, fails to compile in both directions.

### Decided, before the steps get built

Recorded because none of it is readable off the code yet — the code does not exist — and each
one is a fork a later session would otherwise re-litigate from scratch.

| Decision           | Answer                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step routing       | **Eleven URLs, not one route with client state.** §11 wants abandonment per step, and page views give that for free while a `currentStep` field drifts the first time someone adds a sub-screen. Back button too                      |
| Draft storage      | **A `booking_drafts` row keyed by an httpOnly cookie.** Not localStorage: the abandonment sweep is the authority and cannot run on a browser that closed in a lift with no signal                                                     |
| Draft shape        | Built against the **input** side of the domain schemas — a half-finished booking is invalid by definition and `ManifestSchema` requires a line. `toQuoteInput` is where it becomes real or fails                                      |
| Price authority    | Request bodies **cannot express a price** — the server reads the draft. Four locks: no money key in the schema, server rebuilds `QuoteInput`, `pricingInput` persisted canonically and replayed at book, hash as drift telemetry only |
| Auth / OTP         | **Deferred to WS-11**, which already owns phone OTP. Until then the flow wires the seeded customer. It blocks step 08 and nothing earlier                                                                                             |
| Multi-stop         | Schema and UI built, **default off behind a feature flag** (`feature_flags` exists and is seeded). Step 10's "add a stop" is not flagged — §04 requires it                                                                            |
| Matching transport | **Poll `/api/jobs/[jobId]/state`** until WS-7 exists. No WebSocket in `apps/web`: §07 is explicit that dispatch is not serverless, and a socket here is the one-box mistake                                                           |
| Protection tier    | **Step 07, in a Sheet.** It changes the locked number, so it cannot come after the number is shown                                                                                                                                    |

### The draft plumbing — what the steps are built on

**The cookie is a credential, not an identifier, and the two are different values.** A draft is a
customer's home address, the address they are moving to, the day the flat will be empty and a rough
inventory of what is in it — so whoever holds the key to it holds a burglary plan filed under
"abandoned cart". `booking_drafts.id` is a `drf_` ULID that travels in request bodies, because
`CreateQuoteRequest.draftId` has to name a draft. The cookie holds 256 bits of `crypto.getRandomValues`
and the table stores its SHA-256. Collapsing them would make every draft id a bearer token, and
`ulid()` draws its randomness from `Math.random` — a documented non-cryptographic generator, perfect
for a log line and useless as a credential. Storing the hash is the same argument one layer down: a
dump, a backup or a slow-query log then carries nothing that can be replayed.

**The step model lives in `@haul/contracts`, and it does not decide what "done" means.**
`draftProblems` already answers what is missing, and it is the same function the server refuses to
price with; the step model only says **which screen owns each problem code**, as a total `Record`, so
a new `DraftProblemCode` fails to compile until someone decides which screen clears it. A guard with
its own reading of the draft would eventually disagree with the pricing path, and that surfaces as a
customer bounced back to a form they have already filled in — or waved through to a price screen that
then refuses to produce a price. It is in the package rather than the app because `apps/mobile` walks
the same funnel: a second set of step names is a second funnel, two charts that cannot be added.

**Nothing writes on a page render.** `proxy.ts` mints the session token — a value, no lookup — and
the row is created only when a customer answers something. Server Components render on prefetch, on
refresh and more than once per navigation, so a row per hover over "get a price" is a table of drafts
belonging to nobody. Verified against the real app: walking the whole flow leaves zero rows.

**A write is a read-modify-write under a row lock, and the lock is taken on the index's predicate.**
Two tabs is ordinary rather than adversarial. The subtle half is that the partial unique index says
`job_id is null` and nothing about expiry, so a save that locked on the _filtered_ predicate would
collide with a row it had just been told was not there — twice, since the retry repeats the query —
and that session could never write again. The read path still filters `expires_at`, because
resurrecting a draft past its retention date is what the column exists to prevent.

**Four things went in as database constraints rather than as care.** The `version` column is a copy of
a field inside the jsonb beside it, kept as a column so a migration can find old rows by index instead
of scanning every draft ever written — and a copy free to disagree with its original is worse than no
copy, because the migration then rewrites the rows whose column says 1 and leaves the ones whose
document says 1. Same for `locale`. Plus `jsonb_typeof(draft) = 'object'`, since jsonb accepts a bare
string as valid JSON, and `session_token_hash ~ '^[0-9a-f]{64}$'`, which is what stops the empty
string a silently-failing hash step would write and then match itself against.

### Resume here

The draft plumbing is committed and green. Everything after it is ordinary work in a fixed order:

1. ~~`booking_drafts` migration, the session cookie, the step model, server-side guards, `/book`
   resume~~ — **done.** The step _order_ ended up in `@haul/contracts` rather than a web-side
   `steps.ts`, for the reason above; `apps/web/src/booking/paths.ts` owns only the URLs
2. Steps `01`–`02` — presets, the 24-item first screen, search, quantities, refused-item block.
   **This is the commit that adds the first server action**, and therefore the first caller of
   `updateDraft`; `zod` comes back into `apps/web` with it
3. Step `03` — Places handlers against `FakeGeoProvider`, autocomplete combobox, stop list.
   **`routedDistanceMeters` is written server-side onto the draft**, never accepted from a client
4. Step `04` — access form (elevator is four options, never a boolean), crane sheet from `assessCraneNeed`
5. Steps `05`–`06` — Shabbat calendar over `bookableDaysBetween`, window picker, truck and crew
6. Step `07` — client preview via `computeQuote`, `createQuote` server action, Price Card, countdown
7. Step `08` — `FakeAcquiringProvider`, tokenise, `bookJob`. Scheduled bookings **save** the card
   and place no hold; copy saying "we've charged your card" there would be false (decision 11)
8. Steps `09`–`11` — matching progress, job sheet, adjustments, cancel, receipt, tip, rate, rebook
9. Instrumentation — the client event union and the server-side abandonment sweep

Each step ends green on `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and is one commit.

## WS-6 · Web — ops console

Built alongside the MVP, not after it. Plan §05: "a human will save more jobs than the algorithm does".

- [ ] Auth + role gating (ops / support / admin)
- [ ] Live board — every active job, colour-coded, at-risk pinned
- [ ] Manual dispatch — force-assign, widen radius, sweeten payout, call customer
- [ ] Driver approvals — document queue, expiry tracking, auto-suspend on lapse
- [ ] Disputes — side-by-side load/unload photos, transcript, refund + debit, SLA timer
- [ ] Pricing knobs — per-city rates editable without a deploy
- [ ] Promos — codes, first-job discounts, earnings guarantees, referrals
- [ ] Support view — read-only impersonation with audit log
- [ ] Fraud flags — repeat cancellers, off-platform contact, GPS spoofing, duplicate devices

## WS-7 · Dispatch service — `services/dispatch`

Stateful, always-on. Explicitly **not** serverless (plan §07).

- [ ] Service scaffold — long-lived Node process, health checks
- [ ] WebSocket layer — driver connections, auth, heartbeat, reconnect
- [ ] Driver presence + location ingest (every 5s) → Redis hot state
- [ ] Eligible-pool filter — capacity, equipment, rating, not busy
- [ ] Wave 1 — top 3 by score, 0–25s
- [ ] Wave 2 — next 5, wider radius, 25–50s
- [ ] Wave 3 — everyone in range, 50–90s, payout boost
- [ ] Scoring — distance, acceptance rate, rating, similar-job completion, idle time
- [ ] First-accept-wins locking (race-safe)
- [ ] Escalation to human dispatcher + failure logging
- [ ] Scheduled jobs — same machinery, hour-long windows, offered 1–2 days ahead
- [ ] Offer timer durability across restart

## WS-8 · Payments & ledger

**Two rails, not one.** PayPlus and HYP both do J5 authorize / J4 charge, and neither has a
payouts endpoint. There is no Israeli Stripe Connect. Cards come in through the PSP; driver
money goes out through the bank. Collapsing them would hide the float and lose the audit trail.

### Acquiring — customer money in

- [x] `AcquiringProvider` interface — tokenise, authorize, capture, void, refund, read
- [x] Partial capture enforced (**capture ≤ authorized, never more**) — the rule Price Lock rests on
- [x] Authorization expiry tracked; lapsed holds reported on read
- [x] Idempotency on every call — verified a duplicate capture webhook charges once
- [x] `FakeAcquiringProvider` — full in-memory provider, so the whole flow runs with no PSP account
- [x] PayPlus adapter skeleton — endpoint map captured, blocking questions documented
- [!] PayPlus or HYP adapter implemented — needs a sandbox terminal + the PSP answers below
- [ ] HYP adapter
- [ ] Webhook receiver + signature verification

### Payout — driver money out

- [x] Israeli bank account model (bank/branch/account + tax id) with **ID check-digit validation**
- [x] `PayoutProvider` interface + `ManualExportPayoutProvider` (CSV for the bank portal)
- [x] Batch validation — catches duplicate driver lines, bad tax ids, total mismatches
- [ ] Ops console payout screen (WS-6)
- [!] Masav file provider — record layout comes from the bank, not inventable
- [ ] Instant-payout option

### Ledger

- [x] Double-entry postings for capture, tip, cancellation fee, PSP deposit, payout, refund, incentive
- [x] **Balance invariant enforced twice** — posting functions refuse to emit unbalanced entries, and the schema re-checks at write time
- [x] VAT split: revenue booked net, VAT booked separately
- [x] Promo booked as marketing expense — **drivers are paid on the undiscounted fare**
- [x] PSP clearing vs bank account kept distinct, so the float is visible
- [x] **22 tests** — including a full job lifecycle that nets to zero across all accounts

## WS-9 · Mobile — customer app (`apps/mobile`)

- [ ] Expo + expo-router scaffold, EAS config
- [ ] RTL + Hebrew, dynamic type
- [ ] Phone OTP auth (+972)
- [ ] Full booking flow, shared logic with web
- [ ] Live job sheet + push notifications
- [ ] Receipt + photo archive + rebook

## WS-10 · Mobile — driver app

- [ ] Onboarding — ID, licence, registration, insurance cert, truck photos, bank, clearance
- [ ] Approval status tracker naming exactly what is blocking
- [ ] Go-online toggle, earnings today, scheduled jobs, demand map
- [ ] **Offer card** — payout, distance, full manifest, floors, elevator, parking, est. minutes, countdown. No blind accepts.
- [ ] Background location + battery-safe cadence
- [ ] Navigate hand-off (Waze first — Israel), geofenced arrival, "I'm here"
- [ ] Load photos (required to advance)
- [ ] Manifest ticking + flag-not-on-list → customer-approved adjustment
- [ ] Unload photos + signature/PIN
- [ ] Earnings — per-job breakdown, weekly summary, tips separated

## WS-11 · Trust & safety

- [ ] Driver doc expiry tracker + auto-suspend
- [ ] Customer phone OTP + card-on-file gate
- [ ] **Rotate `haul_booking` at the OTP.** The booking session deliberately never rotates —
      the token is the only key to the draft row, so rotating on arrival would orphan a
      customer's basket on every refresh, and there is no trust transition before this one.
      OTP is the transition: mint a new token, carry the draft across, drop the old one
- [ ] Number-masked calling (Twilio or local equivalent)
- [ ] Share-trip link
- [ ] SOS control in both apps
- [ ] Proof-of-condition photo pipeline (timestamp + geotag, tamper-evident)
- [ ] Claims flow — 48h window, before/after photos, tiered cover
- [ ] Off-platform solicitation detection
- [ ] Data protection — location trails + home addresses retention policy

## WS-12 · Instrumentation

From plan §11 — wired from the first line of code, not the first board meeting.

- [ ] Analytics + error tracking (PostHog + Sentry)
- [ ] Match rate (> 95%)
- [ ] Time to match (< 120s median)
- [ ] Quote → book (> 35%)
- [ ] **Adjustments as share of revenue (< 4%)** — the price lock's health check
- [ ] On-time arrival (> 90%)
- [ ] Damage claims (< 1.5%)
- [ ] Driver 30-day retention (> 60%)
- [ ] Utilization (> 45%)
- [ ] Booking abandonment by step
- [ ] **Log every pricing input + actual duration from job #1**

---

## Deferred — Phase 2 and later

- [-] Scan My Stuff — vision manifest (Phase 2; three-photo version first)
- [-] Choose Your Crew — three nearby movers (Phase 2)
- [-] Protection tiers with a real underwriter (Phase 2)
- [-] Referrals both sides (Phase 2)
- [-] In-app chat (Phase 2 — masked calling covers Phase 1)
- [-] Second city (Phase 2 — only after >95% unaided match rate)
- [-] Learned duration/price models, backhaul matching, fleet accounts (Phase 4)

---

## Open questions

| #   | Question                                                                                                                          | Blocks                                        | Status                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Which Israeli metro + neighbourhood cluster exactly? (Tel Aviv / Gush Dan assumed)                                                | Rate-card calibration, launch ops             | Open — not blocking the build                                                                                            |
| 2   | Hebrew-only at launch, or Hebrew + English + Russian + Arabic?                                                                    | i18n scope, QA matrix                         | Assumed he+en; confirm                                                                                                   |
| 3   | ~~Stripe Connect in Israel?~~                                                                                                     | —                                             | **Resolved** — no Stripe. PayPlus/HYP, two rails. See WS-8.                                                              |
| 3a  | **How long does a PayPlus/HYP J5 hold stay valid?**                                                                               | T-24h authorization timing for scheduled jobs | **Ask the PSP.** Code assumes 24h conservatively                                                                         |
| 3b  | **Can `ChargeByTransactionUID` capture LESS than the J5 amount?**                                                                 | Cancellation fees                             | **Ask the PSP.** If no, a fee becomes a fresh token charge — worse UX, different legal posture                           |
| 3c  | Is there a void/release for a J5 outside the same-day Cancel window?                                                              | Free cancellation                             | Ask the PSP                                                                                                              |
| 3d  | **Agent or principal for VAT?** Does the driver sell to the customer (HAUL takes commission), or does HAUL sell and buy the work? | Every VAT posting, invoicing obligation       | **Needs an Israeli accountant before the first paid job.** Postings currently assume _principal_, isolated to one module |
| 3e  | Does HAUL holding customer funds trigger a payment-services licensing requirement?                                                | Legal structure                               | Ask the lawyer alongside worker classification (Q4)                                                                      |
| 3f  | חשבוניות ישראל allocation numbers — needed for B2B in Phase 3?                                                                    | Invoicing                                     | Confirm before WS Phase 3                                                                                                |
| 4   | Contractor vs. employee structure for drivers under Israeli law                                                                   | Legal, payout, tax                            | Needs a lawyer before launch (plan §12)                                                                                  |
| 5   | Phase 0 (20 manual moves) — running it, or building against estimated rates?                                                      | Pricing accuracy                              | Open — engine is config-driven either way                                                                                |

---

## Log

| Date       | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-08 | Tracking file created. Decisions 1–9 locked. Israel-specific deltas identified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-08 | WS-0 foundation: monorepo, Turbo, Docker infra (Postgres+PostGIS, Redis verified healthy), git.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-08 | WS-1 complete: `@haul/types` — 14 modules, 50 tests green, typecheck clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-08 | Bug found + fixed by test: `shekels()` scaled by multiplication, so ₪8.155 became 815 agorot not 816 (`8.155 * 100 === 815.4999…`). Now rounds in decimal-string space. Also normalised `-0` → `0`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-08 | WS-2a complete: `@haul/calendar` — Hebrew calendar + solar + Israeli dispatch windows. 38 tests green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-08 | Rejected `@hebcal/core` and every npm alternative — all GPL-2.0/LGPL, unusable in a proprietary product. Implemented the arithmetic instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-08 | Calendar epoch was off by 2 days (−1373429 vs −1373427); caught by anchoring 1 Tishrei 5786 to a known date rather than trusting the constant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-08 | Stripe ruled out (no Israeli marketplace payouts). Confirmed via PayPlus API docs: J5/J4 present, **no payouts endpoint at all**. Architecture split into two rails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-08 | Added `JobState.Scheduled` — a payments constraint became a state-machine change. Local J5 holds do not survive a two-week booking lead time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-08 | WS-8 acquiring + payout + ledger postings complete: `@haul/payments`, 22 tests green. Full working in-memory PSP so the rest of the build needs no credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-08 | WS-2 pricing engine complete: `@haul/pricing`, 58 tests green. Rate-card values pending market research.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-08 | Caught an inconsistency between engine and ledger: engine paid drivers a share of the _post-promo_ gross while postings booked promos as marketing expense. Engine now pays on the undiscounted fare and returns `promoAmountGross`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-08 | WS-2b: 10-agent workflow authored a 169-item Israeli catalog, 6 vehicle classes, 7 presets and a sourced Tel Aviv rate card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-08 | Adversarial audit returned 'not shippable': craneCandidate was hand-set noise (20 flags wrong), 4/15 preset ids unresolvable, 8 duplicate objects, LPG cylinder priced as routine cargo. All repaired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-08 | Calibration vs real market prices found the engine quoting ~1.9x high. Root cause: no batching term — the catalog times items handled alone. Added and fitted numerically; RMS error now 3.3%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-08 | Crane repriced as floor bands with hourly call-out (market is banded, not linear). Seasonality added — winter runs 25-30% below summer, the biggest swing in the card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-09 | WS-3 data layer complete: 30 tables, PostGIS generated geography columns, partial GiST index, 17 integration tests. Migrations applied and seeded against real Postgres.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-09 | Verified the dispatch query is index-assisted: ST_DWithin cost 2,191 vs ST_Distance seq scan 37,735 at 3,000 drivers. Test asserts the plan, not just the rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-09 | Ledger balance enforced by a deferred CONSTRAINT TRIGGER, so the DB rejects an imbalance even from a console session or a future non-TS service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-09 | Approved esbuild install scripts in pnpm-workspace.yaml (dev-only, needed by drizzle-kit and tsx). No other package may run install scripts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-09 | WS-4 complete: `@haul/ui` — tokens, generated Tailwind v4 theme + native theme, 9 components, the Price Card. 863 tests green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-09 | Type pairing decided against the market rather than the plan: Heebo + Rubik + Roboto Mono, all OFL. Digit advance widths parsed out of the actual TTFs — Assistant, the default Israeli UI face, has proportional digits and no `tnum`, so its money can never be aligned. Heebo needs no feature at all.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-09 | **Every Button and Chip in the product had no height rule.** Sizes were written `min-h-[${controlHeights.sm}]`. Tailwind discovers utilities by scanning source _text_, so a class assembled at runtime is never a candidate and compiles to nothing — the control collapsed to its line box. Now `min-h-(--control-sm)`, a literal naming a generated custom property.                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-09 | The tap-target tests had been passing on those heightless buttons, because they regexed `className` for `min-h-\[(\d+)px\]` — asserting a string was written, never that a rule existed. Replaced with a helper that compiles real Tailwind against the real theme and resolves `var(--control-sm)` to a number.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-09 | `tailwind.test.ts` added, and it needs two checks rather than one: `compiler.build([cls])` _supplies_ the class as a candidate, so an interpolated `min-h-[44px]` compiles perfectly well when handed over directly. The compiler can prove a class is well-formed; only a source scan can prove the scanner ever found it.                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-09 | Adversarial audit (a11y / RTL / API lenses) returned 24 findings against the first cut. Beyond the above: the loading progressbar was a descendant of `<button>`, where ARIA prunes it from the accessibility tree — so "progress not spinner" was visual only; a stepper disabled the focused button on reaching a bound, dropping focus to `<body>` and escaping the Sheet's focus trap; `showDecimals={false}` rounded rather than hid, letting the signature component display a price nobody would be charged.                                                                                                                                                                                                                   |
| 2026-08-09 | Ledger of one-source-of-truth repairs: the figure treatment (display face + tabular + `font-feature-settings: normal`) was hand-spelled in three components; it now lives in `tokens/type.ts` as the class the generator emits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-10 | WS-5 recon: mapped every shipped package's real export surface against `PLAN.html` §05 before writing a line of the app. The output was mostly a list of things the booking flow needs that no package provides — a draft shape, wire DTOs, a slot model, a routed-distance provider. Those became WS-5·0 rather than app code, because `apps/mobile` needs all of them and extracting later is a merge conflict across every action file.                                                                                                                                                                                                                                                                                            |
| 2026-08-10 | **The advertised minimum fare was 15% below what it advertised.** `RateCard.minimumFare` is the one money field on the card the engine reads as _gross_ — every other is net, summed, and VAT added once at the end. The Tel Aviv card ran it through `fromGross()` like its twenty-one neighbours, so VAT came off twice: an advertised ₪400 floor was really ₪338.98. Calibration never saw it — every sourced anchor (₪1,890–₪5,000) sits far above the floor. Found by checking a plan's claim before building on it.                                                                                                                                                                                                             |
| 2026-08-10 | The fix for that is not the data. `minimumFare` is now `{ vatBasis: 'gross', amount }` and a bare integer does not parse, because the guard it replaced was a heuristic — "an advertised minimum is a round number of shekels" — that caught ₪400 by luck and waves through every figure that is a multiple of 59. ₪590 gross is exactly ₪500 net: round, wrong, invisible. The convention is now stated where it is written, not sniffed at afterwards.                                                                                                                                                                                                                                                                              |
| 2026-08-10 | WS-5·0 shipped: `@haul/geo` and `@haul/contracts` new, four packages extended, `@haul/ui` gains six primitives. 1,068 → 1,808 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-11 | **A crane was billed on every first-floor walk-up.** `neverBelowFloor: 2` is commented "One flight is carried, always. Nobody books a crane for the first floor" and was consulted in exactly one place — as an extra conjunct on the narrow-stairwell branch. So floor 1, no lift, one wardrobe, crane question unanswered fell past every guard onto a terminal `recommend(confirm: true)` whose own comment reads "Floor 2, ordinary stairwell". ₪430 of crane, on the cheapest jobs in the book.                                                                                                                                                                                                                                  |
| 2026-08-11 | That bug shipped inside WS-2 with 58 green tests. The crane suite only ever walked floors 3, 4 and 5, and `neverBelowFloor` appeared in **zero assertions repo-wide**. It surfaced only when `@haul/contracts` made `CraneNeed.Unknown` the default booking path — which is what a customer who never opens the crane question actually sends. The same shape as the WS-2b catalog audit: the numbers reconciled perfectly and were still wrong.                                                                                                                                                                                                                                                                                      |
| 2026-08-11 | Second half of the same defect: the `craneRules` ops override was a no-op on price. Raising `craneFromFloor` only changed the wording, because every floor beneath it still landed on the terminal recommend and was still billed. The ask band now rides one rung under the threshold instead of covering everything below it, so an override of 60 means "no crane below 60" rather than 58 floors of billed-but-uncertain crane.                                                                                                                                                                                                                                                                                                   |
| 2026-08-11 | **The price lock, pointed backwards.** `toQuoteInput` trusted a client-supplied `vehicleClassId` and `crewSize` without flooring either: naming a 2.5m³ pickup for a 3.75m³ load took ₪2,520 to ₪2,220, and `crewSize: 1` against a van whose `minCrew` is 2 took it to ₪2,200 while dispatch sends two movers regardless. The customer may choose up — they are paying for it — never down past what the load physically requires.                                                                                                                                                                                                                                                                                                   |
| 2026-08-11 | `@haul/geo`'s "never estimates" guard asserted `legs.every(isEstimated) === false`, which only says _not all_ legs were guessed. The test one line above it names the mixed case as "the dangerous case: the total looks fine, one leg was guessed, and the quote gets locked anyway" — and this was the test meant to prove it impossible. Mutating the fake so every leg after the first is estimated kept all 81 tests green.                                                                                                                                                                                                                                                                                                      |
| 2026-08-11 | Two of the sixteen audit findings were about a scratch file an auditing agent had itself created mid-run. Worth recording: an adversarial pass generates its own litter, and a finding about litter reads exactly like a finding about the code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-11 | WS-5 scaffold: `apps/web` — Next 16 App Router under a `[locale]` segment, self-hosted Heebo/Rubik/Roboto Mono, a typed message catalog, `proxy.ts` locale negotiation, and one page that renders the actual brand. 103 tests. `pnpm build` had been a no-op since WS-0 and now builds something.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-11 | **Turbopack does not substitute `.ts` for a `.js` specifier under `moduleResolution: Bundler`.** Every relative import in every package carries `.js` — an ESLint rule enforces it, because Node's ESM resolver refuses anything else — so the first `next build` failed with 45 module-not-found errors inside `@haul/types` and `@haul/ui`. Webpack fails identically and its `experimental.extensionAlias` escape hatch is ignored by Turbopack. The app's tsconfig is `nodenext`, which is the setting that fixes it.                                                                                                                                                                                                             |
| 2026-08-11 | The cost of that is that every import in `apps/web` is fully specified, including `next/navigation.js` and `next/server.js` — Next ships no `exports` map, so those subpaths are not resolvable by Node's ESM algorithm either and TypeScript says so. Unusual for a Next app, consistent with the rest of this repo, and greppable if Next ever adds an `exports` map.                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-11 | **`directionAttributes` was on the wrong side of the client boundary.** It lived in `components/direction.tsx` — which must carry `'use client'`, it creates a context at module scope — with a comment saying it was split out precisely so an app root could put `dir`/`lang` on `<html>`. A directive marks the module, so the one function written for a server layout was the one function a server layout could not call. Moved to `lib/direction-attributes.js`; prerender fails without it.                                                                                                                                                                                                                                   |
| 2026-08-11 | That is the WS-5·0 `'use client'` finding one level in, and `use-client.test.ts` could not have caught it: it proves a module carries the directive when it needs one, and a stranded plain function is the opposite failure. Nothing in `packages/ui` has a server to fail on — it surfaced the first time anything rendered `<html>`.                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-11 | Checked the ₪ subset claim against the shipped font files rather than the specimen: U+20AA is in Fontsource's `hebrew` range and in `latin-ext`, and absent from bare `latin`, which carries U+20AC for the euro and stops. 5.3.0 ships one entry point per axis rather than per subset, so a single `wght.css` import gives every subset with its `unicode-range` and the browser fetches what it needs.                                                                                                                                                                                                                                                                                                                             |
| 2026-08-11 | `.env.example` repaired. `PAYMENT_PROVIDER=stripe` and four `STRIPE_*` keys had outlived locked decision 10 by three days. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` deleted outright: a Places key inlined into a browser bundle is a key anyone can lift out of a page and bill to us, and referrer restrictions are a request header rather than authentication. Geo goes behind a server route handler.                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-12 | WS-5 draft plumbing shipped: `booking_drafts`, the session cookie, the step model in `@haul/contracts`, server-side guards, `/book` resume, eight step routes and the landing CTA wired into the flow. 1,911 → 1,997 tests. Verified in the real app, not only in tests: `/book` → mints an httpOnly 30-day cookie → `/he/book/items`, jumping to `/he/book/price` with no draft bounces back, both locales render with the right `dir`, and walking the whole flow leaves **zero** rows — the "nothing writes on a page render" rule, checked rather than asserted.                                                                                                                                                                  |
| 2026-08-12 | **A session whose draft expired could never write again.** The save path locked with `expires_at > now` while the partial unique index says only `job_id is null`, so an expired unbooked row was invisible to the lock and still occupied the session's one open slot. The insert collided with a row the query had just said was not there — twice, because the retry repeats the same query — and threw. Found by reading the two predicates side by side, proved in `psql`, and the regression test fails on the duplicate-key violation with the fix removed. The lock now takes the index's own predicate; the read path still filters expiry, because resurrecting a draft past its retention date is what that column is for. |
| 2026-08-12 | The retry that race protects against had never fired. `isUniqueViolation` checked `error.code` on the outermost error, and Drizzle wraps the driver error in a `DrizzleQueryError` whose own message is the SQL and which carries no code at all — so every `23505` read as "not a unique violation". Two customers' first answers arriving together would have 500'd. The concurrency test caught it; the check now walks the `cause` chain.                                                                                                                                                                                                                                                                                         |
| 2026-08-12 | `@source not '../__tests__/**'` in the app's stylesheet only ever covered `src/__tests__`. The draft store's suite lives at `src/server/__tests__`, so the moment it existed its counter-example classes were being scanned into the shipped CSS — the exact leak that glob exists to prevent, in an RTL-first product whose tests are full of `pl-4` written to prove nobody may. Caught by WS-5's own `tailwind.node.test.ts`. Now `**/__tests__/**` on both sides.                                                                                                                                                                                                                                                                 |
| 2026-08-12 | Test phone numbers collided with `dispatch-query.test.ts`'s bulk insert (`'+9725' \|\| lpad(g, 8, '0')`) under parallel vitest, and `users_phone_key` is unique. The failure lands in whichever file loses the race, which is not the file with the bug. Test data now sits on a prefix nothing else writes.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-12 | **`proxy.ts` does not run on the edge, and three comments said it did.** Next 16 sends a proxy file to `onServer()` unconditionally — `build/entries.js` has no edge branch for it, unlike the legacy `middleware` case directly below — and this app's own build assigns `/_middleware` the `nodejs` runtime with an empty edge manifest. `session.ts` went further and claimed a `node:crypto` import would stop the build; it would compile and run. The rule those comments protect is still right and now says why: the proxy executes on every navigation, `@haul/config` parses a 169-item catalog at import time, and `module-boundaries.node.test.ts` is the only thing enforcing it.                                        |
| 2026-08-12 | Adversarial audit, five lenses, every finding argued against by an independent skeptic: 23 candidates, 18 died. What survived was three doc-versus-code defects, all of the same kind — a comment asserting a mechanism that does not exist. Two lenses independently found the same missing `if (!available) return;` on the one test guarding the expiry bug, which would fail rather than skip on a machine with no Postgres and read exactly like that bug returning.                                                                                                                                                                                                                                                             |
| 2026-08-12 | The audit's refutation of a "the property test is a tautology" finding was correct and turned up something better on the way: five of the thirteen problem codes had no landing assertion at all. Mutation-testing each mapping in turn — re-point one code, run the suite, restore — now shows **13/13 pinned**, where five would previously have survived a silent re-point.                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-12 | The first audit run had to be thrown away and re-run read-only on a frozen tree. Three of five agents died on connection errors; the survivors were reading files I was editing underneath them; and two probe files left in `apps/web/src/server/__tests__` broke `pnpm lint`. This is the WS-5·0 note about audit litter one level worse — an adversarial pass can mutate the code it is auditing, and a mutation left behind reads exactly like the code under review.                                                                                                                                                                                                                                                             |
| 2026-08-11 | Recorded the WS-5 forward plan in this file rather than leaving it in a session: the eight decisions taken before the steps get built, and the order the remaining commits go in. None of it is readable off the code, because the code does not exist yet, and each one is a fork that would otherwise be re-argued from scratch. Also dropped `zod` and `@testing-library/user-event` from `apps/web` — declared by the scaffold and imported by nothing. They come back the moment server actions and interaction tests do.                                                                                                                                                                                                        |
