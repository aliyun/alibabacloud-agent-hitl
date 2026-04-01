/**
 * format.ts 测试
 * 测试格式化函数
 */

import { describe, expect, it } from 'vitest';
import {
  formatTimeoutMessage,
  formatApprovalSuccessMessage,
  formatApprovalRejectedMessage,
} from '../src/format.js';
import type { PendingAction } from '../src/types.js';

describe('formatTimeoutMessage', () => {
  const baseAction: PendingAction = {
    id: 'action-123',
    toolName: 'shell',
    command: 'aliyun ecs DescribeInstances',
    params: {},
    sessionKey: 'agent:main:main',
    riskLevel: 'MEDIUM',
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 300_000,
    message: '请确认是否执行',
  };

  it('格式化超时消息', () => {
    const result = formatTimeoutMessage(baseAction, 300);
    
    expect(result).toContain('⚠️ **审批超时，命令已自动取消**');
    expect(result).toContain('`action-123`');
    expect(result).toContain('MEDIUM');
    expect(result).toContain('5 分钟');
    expect(result).toContain('aliyun ecs DescribeInstances');
  });

  it('使用 hitl.riskLevel 如果存在', () => {
    const actionWithHitl: PendingAction = {
      ...baseAction,
      hitl: {
        authReqId: 'req-123',
        pollingUrl: 'https://example.com/poll',
        confirmUrl: 'https://example.com/confirm',
        approvalTimeout: 300,
        riskLevel: 'HIGH',
        reason: '高风险操作',
      },
    };
    const result = formatTimeoutMessage(actionWithHitl, 600);
    expect(result).toContain('HIGH');
    expect(result).toContain('10 分钟');
  });

  it('正确计算分钟数', () => {
    expect(formatTimeoutMessage(baseAction, 60)).toContain('1 分钟');
    expect(formatTimeoutMessage(baseAction, 120)).toContain('2 分钟');
    expect(formatTimeoutMessage(baseAction, 90)).toContain('1 分钟'); // 向下取整
  });
});

describe('formatApprovalSuccessMessage', () => {
  it('格式化审批成功消息', () => {
    const result = formatApprovalSuccessMessage(
      'aliyun ecs DescribeInstances',
      '{"Instances": []}',
    );
    
    expect(result).toContain('用户已通过风控审批并执行了之前被拦截的命令');
    expect(result).toContain('$ aliyun ecs DescribeInstances');
    expect(result).toContain('{"Instances": []}');
    expect(result).toContain('请根据以上执行结果，继续完成后续任务');
  });

  it('处理多行执行结果', () => {
    const multilineResult = 'line1\nline2\nline3';
    const result = formatApprovalSuccessMessage('ls -la', multilineResult);
    
    expect(result).toContain('line1\nline2\nline3');
  });

  it('处理空执行结果', () => {
    const result = formatApprovalSuccessMessage('echo', '');
    
    expect(result).toContain('$ echo');
  });
});

describe('formatApprovalRejectedMessage', () => {
  it('格式化审批拒绝消息', () => {
    const result = formatApprovalRejectedMessage('aliyun ecs DeleteInstance --InstanceId xxx');
    
    expect(result).toContain('用户已拒绝风控审批');
    expect(result).toContain('不会执行');
    expect(result).toContain('$ aliyun ecs DeleteInstance --InstanceId xxx');
    expect(result).toContain('请询问用户是否需要其他操作');
  });
});
