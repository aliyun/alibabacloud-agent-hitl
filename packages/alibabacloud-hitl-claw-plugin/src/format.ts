/**
 * 格式化工具函数
 */

import type { PendingAction } from './types.js';

/**
 * 格式化审批超时消息
 */
export function formatTimeoutMessage(action: PendingAction, timeoutSec: number): string {
  const timeoutMinDisplay = Math.floor(timeoutSec / 60);
  return [
    `[HITL-plugin] 审批超时通知：以下命令因超时未审批已自动取消，请勿重试或总结，直接告知用户超时情况。`,
    '',
    `⚠️ **审批超时，命令已自动取消**`,
    '',
    `**操作ID:** \`${action.id}\``,
    `**风险等级:** ${action.hitl?.riskLevel || action.riskLevel || 'MEDIUM'}`,
    `**超时时间:** ${timeoutMinDisplay} 分钟`,
    '',
    `**已取消的命令:**`,
    '```',
    action.command,
    '```',
    '',
    `请总结后告知用户。`,
  ].join('\n');
}

/**
 * 格式化审批通过后的 Agent 消息
 */
export function formatApprovalSuccessMessage(command: string, result: string): string {
  return [
    `用户已通过风控审批并执行了之前被拦截的命令，以下是执行结果:`,
    '',
    `$ ${command}`,
    '',
    result,
    '',
    `请根据以上执行结果，继续完成后续任务。如果命令执行失败了，请询问用户是否需要重试，不要自己重试。`,
  ].join('\n');
}

/**
 * 格式化审批拒绝后的 Agent 消息
 */
export function formatApprovalRejectedMessage(command: string): string {
  return [
    `用户已拒绝风控审批，以下命令不会执行:`,
    '',
    `$ ${command}`,
    '',
    `请询问用户是否需要其他操作。`,
  ].join('\n');
}

/**
 * 格式化 Token 校验失败后的 Agent 消息
 */
export function formatTokenValidationFailedMessage(command: string, reason: string): string {
  return [
    `审批校验失败，以下命令无法执行:`,
    '',
    `$ ${command}`,
    '',
    `**失败原因:** ${reason}`,
    '',
    `请告知用户审批校验失败，如有需要可重新发起审批。`,
  ].join('\n');
}
