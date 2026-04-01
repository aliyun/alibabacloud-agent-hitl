/**
 * HITL 风控检测和审批轮询模块
 */

import type { HitlCheckResult, PollResult, PendingAction, Logger, OpenClawPluginApi } from './types.js';
import { execCommand, getCliVersion } from './exec.js';
import { dispatchToAgent } from './channel.js';
import { formatTimeoutMessage, formatApprovalSuccessMessage, formatApprovalRejectedMessage, formatTokenValidationFailedMessage } from './format.js';
import { getActionStore } from './action-store.js';

// ============================================================================
// 风控检测
// ============================================================================

/**
 * 调用风控 API 检测命令风险
 */
export async function checkHitlRule(
  command: string,
  sessionId: string,
  agentId: string,
  logger: Logger,
): Promise<HitlCheckResult> {
  try {
    const cliVersion = await getCliVersion();
    
    // 构建命令
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
    
    // 解析 JSON 响应（API 使用 PascalCase 字段名）
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
      logger.error('[hitl] HITL API JSON parse failed', { error: String(parseErr), result });
      return { success: false, decision: 'ALLOW', error: 'JSON parse failed' };
    }
    
    if (!response.ExecutionDecision) {
      logger.warn('[hitl] HITL API returned no ExecutionDecision, allowing by default');
      return { success: true, decision: 'ALLOW' };
    }
    
    // 转换字段名（PascalCase -> camelCase）
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
    // 调用失败时默认放行（避免影响正常使用）
    return { success: false, decision: 'ALLOW', error: String(err) };
  }
}

// ============================================================================
// 审批轮询
// ============================================================================

/**
 * 轮询响应结构
 */
interface PollApiResponse {
  requestId?: string;
  successResponse?: boolean;
  code?: string;
  message?: string;
  httpStatusCode?: string;
  data?: {
    status?: string;
    token?: string;  // 服务端返回的字段名是 token，不是 hitlToken
  };
}

/**
 * 获取审批状态
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
    
    // 成功状态：继续执行
    if (status === 'CONFIRMED' || status === 'SUCCESS') {
      return { status: 'success', hitlToken };
    }
    
    // 明确的失败状态：返回失败
    if (status === 'REJECTED' || status === 'FAILED' || status === 'TIMEOUT' || status === 'EXPIRED' || status === 'CANCELLED') {
      return { status: 'failed' };
    }
    
    // PENDING 状态：正常轮询
    if (status === 'PENDING') {
      return { status: 'pending' };
    }
    
    // 其他未知状态：10s 后继续轮询
    logger.warn('[hitl] Unknown poll status, will retry in 10s', { status });
    return { status: 'unknown', delayMs: 10000 };
  } catch (err) {
    logger.error('[hitl] Poll exception', { error: String(err) });
    return { status: 'pending' };
  }
}

/**
 * 校验 HITL Token
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

/** 存储正在轮询的 action ID */
const pollingActions = new Set<string>();

/**
 * 清理轮询状态（插件卸载时调用）
 */
export function clearPollingActions(): void {
  pollingActions.clear();
}

/**
 * 启动后台轮询
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
  const pollIntervalMs = 3000; // 3 秒轮询一次
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
    
    // 检查是否超时
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
    
    // 检查 action 是否还存在（可能被用户手动取消）
    if (!store.get(action.id)) {
      api.logger.info('[hitl] Action cancelled, stopping poll', { actionId: action.id });
      pollingActions.delete(action.id);
      return;
    }
    
    const pollResult = await fetchApprovalStatus(pollingUrl, authReqId, sessionId, api.logger);
    
    if (pollResult.status !== 'pending') {
      api.logger.info('[hitl] Poll status changed', { actionId: action.id, status: pollResult.status, pollCount });
    }
    
    // pending 或 unknown 状态：继续轮询
    if (pollResult.status === 'pending' || pollResult.status === 'unknown') {
      const nextDelay = pollResult.delayMs || pollIntervalMs;
      setTimeout(poll, nextDelay);
      return;
    }
    
    pollingActions.delete(action.id);
    
    if (pollResult.status === 'success') {
      // 校验 HITL Token
      const hitlToken = pollResult.hitlToken;
      if (!hitlToken) {
        api.logger.error('[hitl] Approval success but no hitlToken returned', { actionId: action.id });
        store.delete(action.id);
        if (action.sessionKey) {
          const agentMessage = formatTokenValidationFailedMessage(action.command, '服务端未返回校验令牌');
          await dispatchToAgent(action.sessionKey, agentMessage, api);
        }
        return;
      }
      
      const isTokenValid = await validateHitlToken(hitlToken, sessionId, authReqId, api.logger);
      
      if (!isTokenValid) {
        api.logger.warn('[hitl] Token validation failed', { actionId: action.id });
        store.delete(action.id);
        if (action.sessionKey) {
          const agentMessage = formatTokenValidationFailedMessage(action.command, '令牌校验失败');
          await dispatchToAgent(action.sessionKey, agentMessage, api);
        }
        return;
      }
      
      // Token 校验通过，执行命令
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
