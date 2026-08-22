/**
 * Shared validation helpers for Draft Sharks Companion domain objects.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
export type ScoringFormat = 'PPR' | 'HALF_PPR' | 'STANDARD' | 'CUSTOM';
export type StrategyProfile =
  | 'HERO_RB'
  | 'ZERO_RB'
  | 'BALANCED'
  | 'ANCHOR_WR'
  | 'LATE_QB';

/**
 * Validate that a value is a non-empty string.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
}

/**
 * Validate that a value is an integer and within an expected range.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 * @param minimum - Minimum integer threshold.
 */
export function assertInteger(value: unknown, fieldName: string, minimum = Number.MIN_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${fieldName} must be an integer greater than or equal to ${minimum}.`);
  }
}

/**
 * Validate that a numeric value falls within a bounded range.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 * @param minimum - Minimum allowed value.
 * @param maximum - Maximum allowed value.
 */
export function assertNumberInRange(value: unknown, fieldName: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < minimum || value > maximum) {
    throw new TypeError(`${fieldName} must be a number between ${minimum} and ${maximum}.`);
  }
}

/**
 * Validate that a value matches one of the supported fantasy positions.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertPosition(value: unknown, fieldName: string): asserts value is Position {
  const validPositions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  if (typeof value !== 'string' || !validPositions.includes(value as Position)) {
    throw new TypeError(`${fieldName} must be one of: ${validPositions.join(', ')}.`);
  }
}

/**
 * Validate that a strategy profile is supported by the draft engine.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertStrategyProfile(value: unknown, fieldName: string): asserts value is StrategyProfile {
  const validProfiles: StrategyProfile[] = ['HERO_RB', 'ZERO_RB', 'BALANCED', 'ANCHOR_WR', 'LATE_QB'];
  if (typeof value !== 'string' || !validProfiles.includes(value as StrategyProfile)) {
    throw new TypeError(`${fieldName} must be one of: ${validProfiles.join(', ')}.`);
  }
}

/**
 * Validate that a scoring format is supported by the application.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertScoringFormat(value: unknown, fieldName: string): asserts value is ScoringFormat {
  const formats: ScoringFormat[] = ['PPR', 'HALF_PPR', 'STANDARD', 'CUSTOM'];
  if (typeof value !== 'string' || !formats.includes(value as ScoringFormat)) {
    throw new TypeError(`${fieldName} must be one of: ${formats.join(', ')}.`);
  }
}

/**
 * Validate that a value can be parsed into a valid ISO date.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertIsoDate(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${fieldName} must be a valid ISO date string.`);
  }
}

/**
 * Validate that a value is a non-null object.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertObject(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be a non-null object.`);
  }
}

/**
 * Validate that a value is a roster settings object.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertRosterSettings(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  assertObject(value, fieldName);
  const roster = value as Record<string, unknown>;

  if (typeof roster.starters !== 'object' || roster.starters === null || Array.isArray(roster.starters)) {
    throw new TypeError(`${fieldName}.starters must be an object keyed by position.`);
  }

  if (typeof roster.bench !== 'number' || Number.isNaN(roster.bench) || roster.bench < 0) {
    throw new TypeError(`${fieldName}.bench must be a non-negative number.`);
  }

  if (roster.maxPerPosition !== undefined) {
    if (typeof roster.maxPerPosition !== 'object' || roster.maxPerPosition === null || Array.isArray(roster.maxPerPosition)) {
      throw new TypeError(`${fieldName}.maxPerPosition must be an object when provided.`);
    }
  }
}

/**
 * Validate that a value is an array.
 *
 * @param value - Value to validate.
 * @param fieldName - Name to include in the thrown error.
 */
export function assertArray(value: unknown, fieldName: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array.`);
  }
}
