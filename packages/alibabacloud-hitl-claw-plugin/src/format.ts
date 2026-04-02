/**
 * Formatting utility functions
 */

import type { PendingAction } from './types.js';

/**
 * Format approval timeout message
 */
export function formatTimeoutMessage(action: PendingAction, timeoutSec: number): string {
  const timeoutMinDisplay = Math.floor(timeoutSec / 60);
  return [
    `[HITL-plugin] Approval timeout notification: The following command was auto-cancelled due to timeout. Do not retry or summarize, just inform the user about the timeout.`,
    '',
    `⚠️ **Approval Timeout - Command Cancelled**`,
    '',
    `**Action ID:** \`${action.id}\``,
    `**Risk Level:** ${action.hitl?.riskLevel || action.riskLevel || 'MEDIUM'}`,
    `**Timeout:** ${timeoutMinDisplay} minutes`,
    '',
    `**Cancelled Command:**`,
    '```',
    action.command,
    '```',
    '',
    `Please summarize and inform the user.`,
  ].join('\n');
}

/**
 * Format approval success message for Agent
 */
export function formatApprovalSuccessMessage(command: string, result: string): string {
  return [
    `The user has approved the risk control check and executed the previously blocked command. Here is the result:`,
    '',
    `$ ${command}`,
    '',
    result,
    '',
    `Please continue with subsequent tasks based on the execution result above. If the command failed, ask the user if they want to retry. Do not retry automatically.`,
  ].join('\n');
}

/**
 * Format approval rejected message for Agent
 */
export function formatApprovalRejectedMessage(command: string): string {
  return [
    `The user has rejected the risk control approval. The following command will not be executed:`,
    '',
    `$ ${command}`,
    '',
    `Please ask the user if they need any other operations.`,
  ].join('\n');
}

/**
 * Format token validation failed message for Agent
 */
export function formatTokenValidationFailedMessage(command: string, reason: string): string {
  return [
    `Approval validation failed. The following command cannot be executed:`,
    '',
    `$ ${command}`,
    '',
    `**Failure Reason:** ${reason}`,
    '',
    `Please inform the user that the approval validation failed. They may re-initiate the approval if needed.`,
  ].join('\n');
}
