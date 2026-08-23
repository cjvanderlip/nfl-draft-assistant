/**
 * Shared validation helpers for the draft-day path.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

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
