/**
 * exec.ts 测试
 * 
 * 注意：由于 child_process.exec 被 promisify 包装，在 ESM 模式下难以可靠 mock。
 * 这里只测试可以通过实际执行验证的简单场景。
 */

import { describe, expect, it } from 'vitest';
import { execCommand } from '../src/exec.js';

describe('execCommand', () => {
  it('执行简单命令并返回输出', async () => {
    const result = await execCommand('echo hello');
    expect(result).toBe('hello');
  });

  it('无输出时返回 (无输出)', async () => {
    const result = await execCommand('true');
    expect(result).toBe('(无输出)');
  });

  it('命令失败时返回错误信息', async () => {
    const result = await execCommand('exit 1');
    expect(result).toContain('执行失败');
  });

  it('不存在的命令返回错误', async () => {
    const result = await execCommand('nonexistent_command_xyz_123');
    expect(result).toContain('执行失败');
  });
});
