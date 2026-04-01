/**
 * 命令执行工具
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
    return output.trim() || '(无输出)';
  } catch (err: unknown) {
    const error = err as { code?: number; killed?: boolean; message?: string; stdout?: string; stderr?: string };
    if (error.killed) {
      return '执行超时 (60秒)';
    }
    const output = (error.stdout || '') + (error.stderr || '');
    return `执行失败 (exit code: ${error.code ?? 'unknown'}):\n${output || error.message || String(err)}`;
  }
}

/** 缓存 CLI 版本 */
let cachedCliVersion: string | null = null;

/**
 * 获取 aliyun CLI 版本（缓存）
 */
export async function getCliVersion(): Promise<string> {
  if (cachedCliVersion) {
    return cachedCliVersion;
  }
  try {
    const result = await execCommand('aliyun --version');
    // 从 "阿里云CLI命令行工具 3.0.298" 中提取版本号
    const match = result.match(/(\d+\.\d+\.\d+)/);
    cachedCliVersion = match ? match[1] : 'unknown';
    return cachedCliVersion;
  } catch {
    return 'unknown';
  }
}
