import { describe, expect, it } from 'vitest';
import { dayNumber, dayOf, daysBetween, isIsoDay, isIsoTimestamp } from '../../src/domain/shared/date.js';
import { DomainError, fail, ok } from '../../src/domain/shared/result.js';

describe('date arithmetic', () => {
  it('validates calendar days including leap years', () => {
    expect(isIsoDay('2024-02-29')).toBe(true);
    expect(isIsoDay('2026-02-29')).toBe(false);
    expect(isIsoDay('1900-02-29')).toBe(false);
    expect(isIsoDay('2000-02-29')).toBe(true);
    expect(isIsoDay('2026-04-31')).toBe(false);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('26-01-01')).toBe(false);
    expect(isIsoDay('1969-12-31')).toBe(false);
  });

  it('validates ISO timestamps', () => {
    expect(isIsoTimestamp('2026-10-31T12:00:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-10-31T12:00:00Z')).toBe(true);
    expect(isIsoTimestamp('2026-10-31T24:00:00Z')).toBe(false);
    expect(isIsoTimestamp('2026-10-31 12:00:00')).toBe(false);
    expect(isIsoTimestamp('2026-02-30T00:00:00Z')).toBe(false);
  });

  it('numbers days from the epoch', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-03-01')).toBe(59);
    expect(dayNumber('2000-03-01')).toBe(11017);
    expect(() => dayNumber('nope')).toThrow(RangeError);
  });

  it('counts whole days between dates, in both directions', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
    expect(daysBetween('2023-12-31', '2024-03-01')).toBe(61);
    expect(dayOf('2026-10-31T12:00:00.000Z')).toBe('2026-10-31');
  });
});

describe('result helpers', () => {
  it('wraps values and errors', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(fail(['x'])).toEqual({ ok: false, error: ['x'] });
    const error = new DomainError('code', 'message');
    expect(error).toMatchObject({ name: 'DomainError', code: 'code', message: 'message' });
  });
});
