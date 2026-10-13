import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('adapter-express package', () => {
  it('should export the correct package name', () => {
    expect(PACKAGE_NAME).toBe('@mantis/adapter-express');
  });
});
