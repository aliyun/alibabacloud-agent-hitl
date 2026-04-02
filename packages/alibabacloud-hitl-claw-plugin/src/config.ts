/**
 * Configuration Loading Module
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { PluginConfig, Logger } from './types.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  confirmationTimeoutSeconds: 300,
};

/**
 * Load configuration from file
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
