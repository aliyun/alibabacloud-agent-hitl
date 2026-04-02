/**
 * exec.ts tests
 * 
 * Note: Since child_process.exec is wrapped with promisify, it's difficult to reliably mock in ESM mode.
 * Here we only test simple scenarios that can be verified through actual execution.
 */

import { describe, expect, it } from 'vitest';
import { execCommand } from '../src/exec.js';

describe('execCommand', () => {
  it('executes simple command and returns output', async () => {
    const result = await execCommand('echo hello');
    expect(result).toBe('hello');
  });

  it('returns (no output) when no output', async () => {
    const result = await execCommand('true');
    expect(result).toBe('(no output)');
  });

  it('returns error message when command fails', async () => {
    const result = await execCommand('exit 1');
    expect(result).toContain('Execution failed');
  });

  it('returns error for non-existent command', async () => {
    const result = await execCommand('nonexistent_command_xyz_123');
    expect(result).toContain('Execution failed');
  });
});
