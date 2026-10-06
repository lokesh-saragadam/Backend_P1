const normalizeVerdict = require('../utils/normalizeVerdict');

describe('normalizeVerdict', () => {
  test('ACCEPTED -> ACCEPTED', () => {
    expect(normalizeVerdict('ACCEPTED')).toBe('ACCEPTED');
  });

  test('OK -> ACCEPTED', () => {
    expect(normalizeVerdict('OK')).toBe('ACCEPTED');
  });

  test('WRONG_ANSWER -> FAILED', () => {
    expect(normalizeVerdict('WRONG_ANSWER')).toBe('FAILED');
  });

  test('TIME_LIMIT_EXCEEDED -> FAILED', () => {
    expect(normalizeVerdict('TIME_LIMIT_EXCEEDED')).toBe('FAILED');
  });

  test('MEMORY_LIMIT_EXCEEDED -> FAILED', () => {
    expect(normalizeVerdict('MEMORY_LIMIT_EXCEEDED')).toBe('FAILED');
  });

  test('RUNTIME_ERROR -> FAILED', () => {
    expect(normalizeVerdict('RUNTIME_ERROR')).toBe('FAILED');
  });

  test('COMPILATION_ERROR -> FAILED', () => {
    expect(normalizeVerdict('COMPILATION_ERROR')).toBe('FAILED');
  });

  test('PENDING -> OTHER', () => {
    expect(normalizeVerdict('PENDING')).toBe('OTHER');
  });

  test('unknown value -> OTHER', () => {
    expect(normalizeVerdict('SOMETHING_NEW')).toBe('OTHER');
  });

  test('handles whitespace and case', () => {
    expect(normalizeVerdict(' accepted ')).toBe('ACCEPTED');
    expect(normalizeVerdict(' ok ')).toBe('ACCEPTED');
    expect(normalizeVerdict(' wrong_answer ')).toBe('FAILED');
  });

  test('handles missing values', () => {
    expect(normalizeVerdict(null)).toBe('OTHER');
    expect(normalizeVerdict(undefined)).toBe('OTHER');
  });
});