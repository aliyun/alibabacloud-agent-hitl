/**
 * config.ts tests
 * Tests for configuration loading functionality
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';
import * as fs from 'fs';
import type { Logger } from '../src/types.js';

// Mock fs.readFileSync
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(fs.readFileSync);

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads complete config from file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      enabled: false,
      confirmationTimeoutSeconds: 600,
    }));

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(false);
    expect(config.confirmationTimeoutSeconds).toBe(600);
  });

  it('uses defaults to fill partial config', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      enabled: false,
    }));

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(false);
    expect(config.confirmationTimeoutSeconds).toBe(300); // default value
  });

  it('uses default config when file not found', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(true);
    expect(config.confirmationTimeoutSeconds).toBe(300);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('config.json not found'));
  });

  it('uses default config when JSON format is invalid', () => {
    mockReadFileSync.mockReturnValue('invalid json {{{');

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(true);
    expect(config.confirmationTimeoutSeconds).toBe(300);
  });

  it('uses default config for empty config file', () => {
    mockReadFileSync.mockReturnValue('{}');

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(true);
    expect(config.confirmationTimeoutSeconds).toBe(300);
  });
});
