/**
 * @haul/pricing — the pricing engine.
 *
 * Pure: no clock, no network, no database. The client runs it for an instant
 * preview and the server runs the identical code as the only authority, so a
 * preview cannot disagree with the booked price.
 *
 * Everything tunable lives on the rate card, editable per city from the ops
 * console without a deploy. This module owns the *shape* of the formula only.
 */

export * from './rate-card.js';
export * from './working-minutes.js';
export * from './crane.js';
export * from './engine.js';
export * from './input-schema.js';
export * from './canonical-input.js';
export * from './to-quote.js';
export { stableHash, canonicalJson } from './hash.js';
