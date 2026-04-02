/**
 * HITL Risk Detection and Approval Polling Module
 */

import type { HitlCheckResult, PollResult, PendingAction, Logger, OpenClawPluginApi } from './types.js';
import { execCommand, getCliVersion } from './exec.js';
import { dispatchToAgent } from './channel.js';
import { formatTimeoutMessage, formatApprovalSuccessMessage, formatApprovalRejectedMessage, formatTokenValidationFailedMessage } from './format.js';
import { getActionStore } from './action-store.js';

// ============================================================================
// Risk Detection
// ============================================================================

/**
 * Call risk control API to detect command risk
 */
export async function checkHitlRule(
  command: string,
  sessionId: string,
  agentId: string,
  logger: Logger,
): Promise<HitlCheckResult> {
  try {
    const cliVersion = await getCliVersion();
    
    // Build command
    const hitlCommand = [
      'aliyun ims CheckHitlRule',
      `--CliCommand "${command.replace(/"/g, '\\"')}"`,
      `--CliVersion "${cliVersion}"`,
      '--AgentType ""',
      `--AgentName "${agentId}"`,
      '--UserId ""',
      `--SessionId "${sessionId}"`,
      '--force',
    ].join(' ');
    
    const result = await execCommand(hitlCommand);
    
    // Parse JSON response (API uses PascalCase field names)
    interface ApiResponse {
      RequestId?: string;
      ExecutionDecision?: string;
      RiskLevel?: string;
      Reason?: string;
      RiskFactors?: Array<{ Factor: string; Severity: string; Description: string }>;
      ApprovalRequirements?: {
        ApprovalTimeout?: number;
        ConfirmationPrompt?: string;
        ConfirmUrl?: string;
        PollingUrl?: string;
        AuthReqId?: string;
      };
    }
    
    let response: ApiResponse;
    
    try {
      response = JSON.parse(result);
    } catch (parseErr) {
      // JSON parse failed - likely command execution error, return the raw output
      logger.error('[hitl] HITL API response parse failed', { result });
      return { success: false, decision: 'DENY', error: result };
    }
    
    if (!response.ExecutionDecision) {
      logger.warn('[hitl] HITL API returned no ExecutionDecision', { response });
      return { success: false, decision: 'DENY', error: `No ExecutionDecision in response: ${JSON.stringify(response)}` };
    }
    
    // Convert field names (PascalCase -> camelCase)
    const decision = response.ExecutionDecision;
    const riskLevel = response.RiskLevel;
    const reason = response.Reason;
    const approvalRequirements = response.ApprovalRequirements ? {
      authReqId: response.ApprovalRequirements.AuthReqId || '',
      confirmUrl: response.ApprovalRequirements.ConfirmUrl || '',
      pollingUrl: response.ApprovalRequirements.PollingUrl || '',
      approvalTimeout: response.ApprovalRequirements.ApprovalTimeout || 600,
      confirmationPrompt: response.ApprovalRequirements.ConfirmationPrompt || '',
    } : undefined;
    
    logger.info('[hitl] Risk check completed', {
      decision,
      riskLevel,
      reason,
      hasApproval: !!approvalRequirements,
      authReqId: approvalRequirements?.authReqId,
    });
    
    return {
      success: true,
      decision: decision.toUpperCase() as 'ALLOW' | 'ESCALATE' | 'DENY',
      riskLevel,
      reason,
      approvalRequirements,
    };
  } catch (err) {
    logger.error('[hitl] HITL API call failed', { error: String(err), stack: err instanceof Error ? err.stack : undefined });
    // Deny by default on failure (fail-close security policy)
    return { success: false, decision: 'DENY', error: String(err) };
  }
}

// ============================================================================
// Approval Polling
// ============================================================================

/**
 * Poll response structure
 */
interface PollApiResponse {
  requestId?: string;
  successResponse?: boolean;
  code?: string;
  message?: string;
  httpStatusCode?: string;
  data?: {
    status?: string;
    token?: string;  // Server returns 'token', not 'hitlToken'
  };
}

/**
 * Fetch approval status
 */
export async function fetchApprovalStatus(
  pollingUrl: string,
  authReqId: string,
  sessionId: string,
  logger: Logger,
): Promise<PollResult> {
  try {
    const requestBody = JSON.stringify({ AuthRequestId: authReqId, SessionId: sessionId });
    
    const response = await fetch(pollingUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: requestBody,
    });
    
    if (!response.ok) {
      logger.warn('[hitl] Poll request failed', { status: response.status, statusText: response.statusText });
      return { status: 'pending' };
    }
    
    let result: PollApiResponse;
    try {
      result = await response.json() as PollApiResponse;
    } catch (parseErr) {
      logger.error('[hitl] Poll response JSON parse failed', { error: String(parseErr) });
      return { status: 'pending' };
    }
    
    const status = result.data?.status?.toUpperCase();
    const hitlToken = result.data?.token;
    
    // Success status: proceed with execution
    if (status === 'CONFIRMED' || status === 'SUCCESS') {
      return { status: 'success', hitlToken };
    }
    
    // Explicit failure status: return failed
    if (status === 'REJECTED' || status === 'FAILED' || status === 'TIMEOUT' || status === 'EXPIRED' || status === 'CANCELLED') {
      return { status: 'failed' };
    }
    
    // PENDING status: continue polling
    if (status === 'PENDING') {
      return { status: 'pending' };
    }
    
    // Unknown status: retry in 10s
    logger.warn('[hitl] Unknown poll status, will retry in 10s', { status });
    return { status: 'unknown', delayMs: 10000 };
  } catch (err) {
    logger.error('[hitl] Poll exception', { error: String(err) });
    return { status: 'pending' };
  }
}

/**
 * Validate HITL Token
 */
export async function validateHitlToken(
  hitlToken: string,
  sessionId: string,
  authReqId: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const validateCommand = [
      'aliyun ims ValidateHitlToken',
      `--HitlToken "${hitlToken}"`,
      `--SessionId "${sessionId}"`,
      `--AuthRequestId "${authReqId}"`,
      '--force',
    ].join(' ');
    
    const result = await execCommand(validateCommand);
    
    interface ValidateResponse {
      RequestId?: string;
      ValidateResult?: boolean | string;
    }
    
    let response: ValidateResponse;
    try {
      response = JSON.parse(result);
    } catch (parseErr) {
      logger.error('[hitl] ValidateHitlToken JSON parse failed');
      return false;
    }
    
    const isValid = response.ValidateResult === true || response.ValidateResult === 'true';
    logger.info(`[hitl] Token validation result: ${isValid}`);
    return isValid;
  } catch (err) {
    logger.error(`[hitl] ValidateHitlToken call failed: ${String(err)}`);
    return false;
  }
}

/** Store action IDs currently being polled */
const pollingActions = new Set<string>();

/**
 * Clear polling state (called when plugin is unloaded)
 */
export function clearPollingActions(): void {
  pollingActions.clear();
}

/**
 * Start background polling
 */
export function startPolling(
  action: PendingAction,
  api: OpenClawPluginApi,
): void {
  const store = getActionStore();
  
  if (!action.hitl) {
    api.logger.error('[hitl] Cannot start polling: missing hitl info', { actionId: action.id });
    return;
  }
  
  if (pollingActions.has(action.id)) {
    api.logger.warn('[hitl] Action already polling, skipping', { actionId: action.id });
    return;
  }
  
  pollingActions.add(action.id);
  
  const { authReqId, pollingUrl, approvalTimeout } = action.hitl;
  const sessionId = action.sessionKey || '';
  const pollIntervalMs = 3000; // Poll every 3 seconds
  const timeoutMs = approvalTimeout * 1000;
  const startTime = Date.now();
  let pollCount = 0;
  
  api.logger.info('[hitl] Polling started', {
    actionId: action.id,
    command: action.command.slice(0, 50),
    authReqId,
    timeout: approvalTimeout,
  });
  
  const poll = async () => {
    pollCount++;
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    
    // Check for timeout
    if (Date.now() - startTime > timeoutMs) {
      api.logger.warn('[hitl] Approval timeout', { actionId: action.id, pollCount, elapsedSeconds });
      pollingActions.delete(action.id);
      store.delete(action.id);
      
      if (action.sessionKey) {
        const agentMessage = formatTimeoutMessage(action, elapsedSeconds);
        await dispatchToAgent(action.sessionKey, agentMessage, api);
      }
      return;
    }
    
    // Check if action still exists (may have been manually cancelled)
    if (!store.get(action.id)) {
      api.logger.info('[hitl] Action cancelled, stopping poll', { actionId: action.id });
      pollingActions.delete(action.id);
      return;
    }
    
    const pollResult = await fetchApprovalStatus(pollingUrl, authReqId, sessionId, api.logger);
    
    if (pollResult.status !== 'pending') {
      api.logger.info('[hitl] Poll status changed', { actionId: action.id, status: pollResult.status, pollCount });
    }
    
    // pending or unknown status: continue polling
    if (pollResult.status === 'pending' || pollResult.status === 'unknown') {
      const nextDelay = pollResult.delayMs || pollIntervalMs;
      setTimeout(poll, nextDelay);
      return;
    }
    
    pollingActions.delete(action.id);
    
    if (pollResult.status === 'success') {
      // Validate HITL Token
      const hitlToken = pollResult.hitlToken;
      if (!hitlToken) {
        api.logger.error('[hitl] Approval success but no hitlToken returned', { actionId: action.id });
        store.delete(action.id);
        if (action.sessionKey) {
          const agentMessage = formatTokenValidationFailedMessage(action.command, 'Server did not return validation token');
          await dispatchToAgent(action.sessionKey, agentMessage, api);
        }
        return;
      }
      
      const isTokenValid = await validateHitlToken(hitlToken, sessionId, authReqId, api.logger);
      
      if (!isTokenValid) {
        api.logger.warn('[hitl] Token validation failed', { actionId: action.id });
        store.delete(action.id);
        if (action.sessionKey) {
          const agentMessage = formatTokenValidationFailedMessage(action.command, 'Token validation failed');
          await dispatchToAgent(action.sessionKey, agentMessage, api);
        }
        return;
      }
      
      // Token validated, execute command
      const result = await execCommand(action.command);
      api.logger.info('[hitl] Token validated and command executed', { actionId: action.id, resultLength: result.length });
      store.delete(action.id);
      
      if (action.sessionKey) {
        const agentMessage = formatApprovalSuccessMessage(action.command, result);
        await dispatchToAgent(action.sessionKey, agentMessage, api);
      }
    } else {
      api.logger.info('[hitl] Approval rejected', { actionId: action.id, pollCount });
      store.delete(action.id);
      
      if (action.sessionKey) {
        const agentMessage = formatApprovalRejectedMessage(action.command);
        await dispatchToAgent(action.sessionKey, agentMessage, api);
      }
    }
  };
  
  setTimeout(poll, pollIntervalMs);
}
