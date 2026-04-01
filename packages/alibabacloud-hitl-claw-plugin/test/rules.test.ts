/**
 * rules.ts 测试
 * 测试 aliyun CLI 命令提取与解析功能
 */

import { describe, expect, it } from 'vitest';
import { extractAliyunCommands, joinAliyunCommands, extractCommandString } from '../src/rules.js';

describe('extractAliyunCommands', () => {
  it('提取简单的 aliyun 命令', () => {
    const result = extractAliyunCommands('aliyun ims CreateUser --UserName test');
    expect(result).toEqual(['aliyun ims CreateUser --UserName test']);
  });

  it('忽略非 aliyun 命令', () => {
    const result = extractAliyunCommands('ls -la');
    expect(result).toEqual([]);
  });

  it('忽略参数不足的 aliyun 命令（少于 3 个参数）', () => {
    const result = extractAliyunCommands('aliyun --version');
    expect(result).toEqual([]);
  });

  it('从管道命令中提取 aliyun 命令', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances | grep running');
    expect(result).toEqual(['aliyun ecs DescribeInstances']);
  });

  it('从 && 复合命令中提取多个 aliyun 命令', () => {
    const result = extractAliyunCommands('aliyun ims CreateUser --UserName test && aliyun ecs DescribeInstances');
    expect(result).toEqual([
      'aliyun ims CreateUser --UserName test',
      'aliyun ecs DescribeInstances',
    ]);
  });

  it('从复杂复合命令中提取 aliyun 命令', () => {
    const result = extractAliyunCommands('ls && aliyun ims CreateUser --UserName test | grep success; echo done');
    expect(result).toEqual(['aliyun ims CreateUser --UserName test']);
  });

  it('处理带引号参数的命令', () => {
    const result = extractAliyunCommands('aliyun ims CreateUser --UserName "test user"');
    expect(result).toEqual(['aliyun ims CreateUser --UserName "test user"']);
  });

  it('处理带单引号参数的命令', () => {
    const result = extractAliyunCommands("aliyun ims CreateUser --UserName 'test user'");
    expect(result).toEqual(['aliyun ims CreateUser --UserName "test user"']);
  });

  it('返回空数组当输入为空', () => {
    expect(extractAliyunCommands('')).toEqual([]);
    expect(extractAliyunCommands('   ')).toEqual([]);
  });

  it('处理 || 逻辑运算符', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances || echo "failed"');
    expect(result).toEqual(['aliyun ecs DescribeInstances']);
  });

  it('处理分号分隔的命令', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances; aliyun ims GetUser --UserPrincipalName test');
    expect(result).toEqual([
      'aliyun ecs DescribeInstances',
      'aliyun ims GetUser --UserPrincipalName test',
    ]);
  });

  it('处理后台执行符 &', () => {
    const result = extractAliyunCommands('aliyun ecs DescribeInstances &');
    expect(result).toEqual(['aliyun ecs DescribeInstances']);
  });
});

describe('joinAliyunCommands', () => {
  it('拼接多个命令', () => {
    const result = joinAliyunCommands([
      'aliyun ims CreateUser --UserName test',
      'aliyun ecs DescribeInstances',
    ]);
    expect(result).toBe('aliyun ims CreateUser --UserName test && aliyun ecs DescribeInstances');
  });

  it('单个命令直接返回', () => {
    const result = joinAliyunCommands(['aliyun ecs DescribeInstances']);
    expect(result).toBe('aliyun ecs DescribeInstances');
  });

  it('空数组返回空字符串', () => {
    expect(joinAliyunCommands([])).toBe('');
  });
});

describe('extractCommandString', () => {
  it('从 command 参数提取', () => {
    expect(extractCommandString({ command: 'ls -la' })).toBe('ls -la');
  });

  it('从 cmd 参数提取', () => {
    expect(extractCommandString({ cmd: 'pwd' })).toBe('pwd');
  });

  it('从 script 参数提取', () => {
    expect(extractCommandString({ script: 'echo hello' })).toBe('echo hello');
  });

  it('从单一参数提取', () => {
    expect(extractCommandString({ input: 'some command' })).toBe('some command');
  });

  it('优先级：command > cmd > script', () => {
    expect(extractCommandString({ cmd: 'cmd', command: 'command' })).toBe('command');
  });

  it('非字符串参数返回 null', () => {
    expect(extractCommandString({ command: 123 })).toBe(null);
    expect(extractCommandString({ command: null })).toBe(null);
  });

  it('空对象返回 null', () => {
    expect(extractCommandString({})).toBe(null);
  });
});
