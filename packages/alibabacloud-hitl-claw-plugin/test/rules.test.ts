/**
 * rules.ts tests
 * Tests for aliyun CLI command extraction and parsing functionality
 */

import { describe, expect, it } from 'vitest';
import { extractAliyunCommands, joinAliyunCommands, extractCommandString } from '../src/rules.js';

describe('extractAliyunCommands', () => {
  it('extracts simple aliyun command', () => {
    const result = extractAliyunCommands('aliyun ims CreateUser --UserName test');
    expect(result).toEqual(['aliyun ims CreateUser --UserName test']);
  });

  it('ignores non-aliyun commands', () => {
    const result = extractAliyunCommands('ls -la');
    expect(result).toEqual([]);
  });

  it('ignores aliyun commands with insufficient arguments (less than 3)', () => {
    const result = extractAliyunCommands('aliyun --version');
    expect(result).toEqual([]);
  });

  it('extracts aliyun command from piped command', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances | grep running');
    expect(result).toEqual(['aliyun ecs DescribeInstances']);
  });

  it('extracts multiple aliyun commands from && composite command', () => {
    const result = extractAliyunCommands('aliyun ims CreateUser --UserName test && aliyun ecs DescribeInstances');
    expect(result).toEqual([
      'aliyun ims CreateUser --UserName test',
      'aliyun ecs DescribeInstances',
    ]);
  });

  it('extracts aliyun command from complex composite command', () => {
    const result = extractAliyunCommands('ls && aliyun ims CreateUser --UserName test | grep success; echo done');
    expect(result).toEqual(['aliyun ims CreateUser --UserName test']);
  });

  it('handles command with double-quoted arguments', () => {
    const result = extractAliyunCommands('aliyun ims CreateUser --UserName "test user"');
    expect(result).toEqual(['aliyun ims CreateUser --UserName "test user"']);
  });

  it('handles command with single-quoted arguments', () => {
    const result = extractAliyunCommands("aliyun ims CreateUser --UserName 'test user'");
    expect(result).toEqual(['aliyun ims CreateUser --UserName "test user"']);
  });

  it('returns empty array when input is empty', () => {
    expect(extractAliyunCommands('')).toEqual([]);
    expect(extractAliyunCommands('   ')).toEqual([]);
  });

  it('handles || logical operator', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances || echo "failed"');
    expect(result).toEqual(['aliyun ecs DescribeInstances']);
  });

  it('handles semicolon-separated commands', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances; aliyun ims GetUser --UserPrincipalName test');
    expect(result).toEqual([
      'aliyun ecs DescribeInstances',
      'aliyun ims GetUser --UserPrincipalName test',
    ]);
  });

  it('handles background execution operator &', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances &');
    expect(result).toEqual(['aliyun ecs DescribeInstances']);
  });
});

describe('joinAliyunCommands', () => {
  it('joins multiple commands', () => {
    const result = joinAliyunCommands([
      'aliyun ims CreateUser --UserName test',
      'aliyun ecs DescribeInstances',
    ]);
    expect(result).toBe('aliyun ims CreateUser --UserName test && aliyun ecs DescribeInstances');
  });

  it('returns single command directly', () => {
    const result = joinAliyunCommands(['aliyun ecs DescribeInstances']);
    expect(result).toBe('aliyun ecs DescribeInstances');
  });

  it('returns empty string for empty array', () => {
    expect(joinAliyunCommands([])).toBe('');
  });
});

describe('extractCommandString', () => {
  it('extracts from command parameter', () => {
    expect(extractCommandString({ command: 'ls -la' })).toBe('ls -la');
  });

  it('extracts from cmd parameter', () => {
    expect(extractCommandString({ cmd: 'pwd' })).toBe('pwd');
  });

  it('extracts from script parameter', () => {
    expect(extractCommandString({ script: 'echo hello' })).toBe('echo hello');
  });

  it('extracts from single parameter', () => {
    expect(extractCommandString({ input: 'some command' })).toBe('some command');
  });

  it('priority: command > cmd > script', () => {
    expect(extractCommandString({ cmd: 'cmd', command: 'command' })).toBe('command');
  });

  it('returns null for non-string parameters', () => {
    expect(extractCommandString({ command: 123 })).toBe(null);
    expect(extractCommandString({ command: null })).toBe(null);
  });

  it('returns null for empty object', () => {
    expect(extractCommandString({})).toBe(null);
  });
});
