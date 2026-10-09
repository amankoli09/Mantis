import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getColors, isColorEnabled, setNoColor } from '../src/ui/color.js';
import { runCli } from '../src/cli.js';

describe('CLI Color handling', () => {
  const originalEnvNoColor = process.env.NO_COLOR;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    setNoColor(false);
    // Simulate TTY for testing color behavior
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    if (originalEnvNoColor !== undefined) {
      process.env.NO_COLOR = originalEnvNoColor;
    } else {
      delete process.env.NO_COLOR;
    }
    setNoColor(false);
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('honors setNoColor(true)', () => {
    expect(isColorEnabled()).toBe(true);

    setNoColor(true);
    expect(isColorEnabled()).toBe(false);

    const c = getColors();
    expect(c.bold('hello')).toBe('hello');
    expect(c.green('success')).toBe('success');
    expect(c.red('error')).toBe('error');
  });

  it('honors NO_COLOR environment variable', () => {
    expect(isColorEnabled()).toBe(true);

    process.env.NO_COLOR = '1';
    expect(isColorEnabled()).toBe(false);

    const c = getColors();
    expect(c.yellow('warn')).toBe('warn');
  });

  it('sets no-color via --no-color CLI option', async () => {
    expect(isColorEnabled()).toBe(true);

    // Call CLI with --no-color
    await runCli(['node', 'devguard', '--no-color', 'init', '--help']).catch(() => {});
    expect(isColorEnabled()).toBe(false);
  });
});
