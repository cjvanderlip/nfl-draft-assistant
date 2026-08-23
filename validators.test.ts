import { describe, expect, it } from 'vitest';

import {
  assertArray,
  assertInteger,
  assertNonEmptyString,
  assertNumberInRange,
  assertObject,
} from './validators.js';

describe('assertNonEmptyString', () => {
  it('accepts a valid string value', () => {
    expect(() => assertNonEmptyString('BUF', 'team')).not.toThrow();
  });

  it('throws for an empty or whitespace-only string', () => {
    expect(() => assertNonEmptyString('', 'team')).toThrow(TypeError);
    expect(() => assertNonEmptyString('   ', 'team')).toThrow(TypeError);
  });

  it('throws for a non-string value', () => {
    expect(() => assertNonEmptyString(7, 'team')).toThrow(TypeError);
  });

  it('names the field in the message', () => {
    expect(() => assertNonEmptyString('', 'leagueId')).toThrow(/leagueId/);
  });
});

describe('assertInteger', () => {
  it('accepts an integer at or above the minimum', () => {
    expect(() => assertInteger(1, 'draftSlot', 1)).not.toThrow();
    expect(() => assertInteger(12, 'draftSlot', 1)).not.toThrow();
  });

  it('throws below the minimum', () => {
    expect(() => assertInteger(0, 'draftSlot', 1)).toThrow(TypeError);
  });

  it('throws for a fractional value', () => {
    expect(() => assertInteger(2.5, 'rounds')).toThrow(TypeError);
  });
});

describe('assertNumberInRange', () => {
  it('accepts a value inside the range and its boundaries', () => {
    expect(() => assertNumberInRange(0.6, 'confidence', 0, 1)).not.toThrow();
    expect(() => assertNumberInRange(0, 'confidence', 0, 1)).not.toThrow();
    expect(() => assertNumberInRange(1, 'confidence', 0, 1)).not.toThrow();
  });

  it('throws outside the range', () => {
    expect(() => assertNumberInRange(2, 'confidence', 0, 1)).toThrow(TypeError);
    expect(() => assertNumberInRange(-1, 'confidence', 0, 1)).toThrow(TypeError);
  });

  it('throws for a non-finite value', () => {
    expect(() => assertNumberInRange(Number.NaN, 'confidence', 0, 1)).toThrow(TypeError);
  });
});

describe('assertObject', () => {
  it('accepts a plain object', () => {
    expect(() => assertObject({ a: 1 }, 'payload')).not.toThrow();
  });

  it('rejects null and arrays, which are the shapes a bad payload actually takes', () => {
    expect(() => assertObject(null, 'payload')).toThrow(TypeError);
    expect(() => assertObject([], 'payload')).toThrow(TypeError);
  });
});

describe('assertArray', () => {
  it('accepts an array', () => {
    expect(() => assertArray(['One', 'Two'], 'draftOrder')).not.toThrow();
  });

  it('throws for a non-array', () => {
    expect(() => assertArray({ 0: 'One' }, 'draftOrder')).toThrow(TypeError);
  });
});
