/**
 * Command Execution Utility
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a shell command and return the result
 */
export async function execCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60_000, // 60 seconds
      maxBuffer: 1024 * 1024, // 1MB
    });
    const output = (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
    return output.trim() || '(no output)';
  } catch (err: unknown) {
    const error = err as { code?: number; killed?: boolean; message?: string; stdout?: string; stderr?: string };
    if (error.killed) {
      return 'Execution timeout (60s)';
    }
    const output = (error.stdout || '') + (error.stderr || '');
    return `Execution failed (exit code: ${error.code ?? 'unknown'}):\n${output || error.message || String(err)}`;
  }
}

/** Cache CLI version */
let cachedCliVersion: string | null = null;

/**
 * Get aliyun CLI version (cached)
 */
export async function getCliVersion(): Promise<string> {
  if (cachedCliVersion) {
    return cachedCliVersion;
  }
  try {
    const result = await execCommand('aliyun --version');
    // Extract version number from "Alibaba Cloud CLI 3.0.298"
    const match = result.match(/(\d+\.\d+\.\d+)/);
    cachedCliVersion = match ? match[1] : 'unknown';
    return cachedCliVersion;
  } catch {
    return 'unknown';
  }
}
