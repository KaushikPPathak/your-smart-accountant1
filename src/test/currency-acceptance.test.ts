import { describe, it, expect } from 'vitest';
import { parseToPaise } from '../lib/utils/currency-utils';

describe('Currency Acceptance Gate', () => {
  it('handles all standard accounting inputs correctly', () => {
    expect(parseToPaise(1000)).toBe(100000);
    expect(parseToPaise("123.45")).toBe(12345);
    expect(parseToPaise("1,234.56")).toBe(123456);
    expect(parseToPaise(0)).toBe(0);
    expect(parseToPaise(-10.50)).toBe(-1050);
    expect(parseToPaise("")).toBe(0);
    expect(parseToPaise(null as any)).toBe(0);
    expect(parseToPaise(undefined as any)).toBe(0);
    expect(parseToPaise("abc")).toBe(0);
    expect(parseToPaise(Number.NaN)).toBe(0);
    expect(parseToPaise(100000000.55)).toBe(10000000055);
  });
});
