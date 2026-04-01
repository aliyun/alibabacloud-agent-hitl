/**
 * 配置加载模块
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { PluginConfig, Logger } from './types.js';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  confirmationTimeoutSeconds: 300,
};

/**
 * 从文件加载配置
 */
export function loadConfig(logger: Logger): PluginConfig {
  try {
    const configPath = join(__dirname, '..', 'config.json');
    const content = readFileSync(configPath, 'utf-8');
    const fileConfig = JSON.parse(content) as Partial<PluginConfig>;
    
    return {
      enabled: fileConfig.enabled ?? DEFAULT_CONFIG.enabled,
      confirmationTimeoutSeconds: fileConfig.confirmationTimeoutSeconds ?? DEFAULT_CONFIG.confirmationTimeoutSeconds,
    };
  } catch {
    logger.debug?.('[hitl] config.json not found, using defaults');
    return DEFAULT_CONFIG;
  }
}
