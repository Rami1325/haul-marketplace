/**
 * @haul/config — the values, as opposed to the logic.
 *
 * The item catalog, vehicle classes, preset bundles and per-city rate cards.
 * `@haul/pricing` owns the shape of the formula; this package owns the numbers
 * that go into it, because those two things change on entirely different
 * schedules and mixing them turns a price change into a release.
 */

export * from './catalog.js';
export * from './cities/tel-aviv.js';
export { CITIES, cityById, DEFAULT_CITY_ID, type CityConfig } from './cities/index.js';
