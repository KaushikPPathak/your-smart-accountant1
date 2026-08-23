import { describe, it, expect } from 'vitest';

describe('Regression Pass 5: Local-Only Guardrails', () => {
  it('Confirm local-only mode is forced at runtime', async () => {
    const { isLocalOnlyMode } = await import('@/lib/local-only-mode');
    
    // The project default is true. 
    expect(isLocalOnlyMode()).toBe(true);
  });
});
