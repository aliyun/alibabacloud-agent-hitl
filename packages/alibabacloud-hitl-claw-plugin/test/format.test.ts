/**
 * format.ts tests
 * Tests for formatting functions
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
    message: 'Please confirm execution',
  };

  it('formats timeout message', () => {
    const result = formatTimeoutMessage(baseAction, 300);
    
    expect(result).toContain('**Approval Timeout - Command Cancelled**');
    expect(result).toContain('`action-123`');
    expect(result).toContain('MEDIUM');
    expect(result).toContain('5 minutes');
    expect(result).toContain('aliyun ecs DescribeInstances');
  });

  it('uses hitl.riskLevel if exists', () => {
    const actionWithHitl: PendingAction = {
      ...baseAction,
      hitl: {
        authReqId: 'req-123',
        pollingUrl: 'https://example.com/poll',
        confirmUrl: 'https://example.com/confirm',
        approvalTimeout: 300,
        riskLevel: 'HIGH',
        reason: 'High risk operation',
      },
    };
    const result = formatTimeoutMessage(actionWithHitl, 600);
    expect(result).toContain('HIGH');
    expect(result).toContain('10 minutes');
  });

  it('calculates minutes correctly', () => {
    expect(formatTimeoutMessage(baseAction, 60)).toContain('1 minutes');
    expect(formatTimeoutMessage(baseAction, 120)).toContain('2 minutes');
    expect(formatTimeoutMessage(baseAction, 90)).toContain('1 minutes'); // floor
  });
});

describe('formatApprovalSuccessMessage', () => {
  it('formats approval success message', () => {
    const result = formatApprovalSuccessMessage(
      'aliyun ecs DescribeInstances',
      '{"Instances": []}',
    );
    
    expect(result).toContain('The user has approved the risk control check');
    expect(result).toContain('$ aliyun ecs DescribeInstances');
    expect(result).toContain('{"Instances": []}');
    expect(result).toContain('Please continue with subsequent tasks');
  });

  it('handles multiline execution result', () => {
    const multilineResult = 'line1\nline2\nline3';
    const result = formatApprovalSuccessMessage('ls -la', multilineResult);
    
    expect(result).toContain('line1\nline2\nline3');
  });

  it('handles empty execution result', () => {
    const result = formatApprovalSuccessMessage('echo', '');
    
    expect(result).toContain('$ echo');
  });
});

describe('formatApprovalRejectedMessage', () => {
  it('formats approval rejected message', () => {
    const result = formatApprovalRejectedMessage('aliyun ecs DeleteInstance --InstanceId xxx');
    
    expect(result).toContain('The user has rejected the risk control approval');
    expect(result).toContain('will not be executed');
    expect(result).toContain('$ aliyun ecs DeleteInstance --InstanceId xxx');
    expect(result).toContain('Please ask the user if they need any other operations');
  });
});
