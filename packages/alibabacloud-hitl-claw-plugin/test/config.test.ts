/**
 * config.ts 测试
 * 测试配置加载功能
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

  it('从配置文件加载完整配置', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      enabled: false,
      confirmationTimeoutSeconds: 600,
    }));

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(false);
    expect(config.confirmationTimeoutSeconds).toBe(600);
  });

  it('配置文件部分字段时使用默认值补全', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      enabled: false,
    }));

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(false);
    expect(config.confirmationTimeoutSeconds).toBe(300); // 默认值
  });

  it('配置文件不存在时使用默认配置', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(true);
    expect(config.confirmationTimeoutSeconds).toBe(300);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('config.json not found'));
  });

  it('配置文件 JSON 格式错误时使用默认配置', () => {
    mockReadFileSync.mockReturnValue('invalid json {{{');

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(true);
    expect(config.confirmationTimeoutSeconds).toBe(300);
  });

  it('空配置文件时使用默认配置', () => {
    mockReadFileSync.mockReturnValue('{}');

    const logger = createMockLogger();
    const config = loadConfig(logger);

    expect(config.enabled).toBe(true);
    expect(config.confirmationTimeoutSeconds).toBe(300);
  });
});
