/**
 * OpenClaw Alibaba Cloud HITL Interceptor Plugin
 *
 * Intercepts Alibaba Cloud CLI commands, detects sensitive operations through risk control API, and implements human approval workflow.
 *
 * Workflow:
 * 1. Agent calls exec tool → Plugin intercepts
 * 2. Call risk control API to detect command risk → ALLOW/DENY/ESCALATE
 * 3. On ESCALATE, store command and start approval polling
 * 4. User approves → Execute command and notify Agent to continue
 */

import type {
  OpenClawPluginApi,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
  PluginHookBeforeToolCallResult,
  PluginHookMessageReceivedEvent,
  PluginHookMessageContext,
} from './types.js';
import { getActionStore, destroyActionStore } from './action-store.js';
import { loadConfig } from './config.js';
import { extractCommandString, extractAliyunCommands, joinAliyunCommands } from './rules.js';
import { checkHitlRule, startPolling, clearPollingActions } from './hitl.js';
import { isMainChannel, isDingtalkChannel, cacheOriginalTarget, clearOriginalTargetCache } from './channel.js';

// ============================================================================
// Plugin Entry
// ============================================================================

export default function register(api: OpenClawPluginApi): void {
  const config = loadConfig(api.logger);

  if (!config.enabled) {
    api.logger.info('[hitl] Plugin disabled');
    return;
  }

  api.logger.info('[hitl] Plugin loaded');

  const store = getActionStore();

  // -------------------------------------------------------------------------
  // Register message_received hook (cache original conversationId)
  // -------------------------------------------------------------------------
  api.on(
    'message_received',
    (
      _event: PluginHookMessageReceivedEvent,
      ctx: PluginHookMessageContext,
    ): void => {
      // Cache original conversationId (preserving case) for later use when routing back
      // This is needed because sessionKey converts target to lowercase, but DingTalk API needs original case
      if (ctx.channelId && ctx.conversationId) {
        const lowercaseKey = `${ctx.channelId}:${ctx.conversationId.toLowerCase()}`;
        cacheOriginalTarget(lowercaseKey, ctx.conversationId);
      }
    },
    { name: 'alibaba-cloud-hitl-message-received' },
  );

  // -------------------------------------------------------------------------
  // Register before_tool_call hook (core interception logic)
  // -------------------------------------------------------------------------
  api.on(
    'before_tool_call',
    async (
      event: PluginHookBeforeToolCallEvent,
      ctx: PluginHookToolContext,
    ): Promise<PluginHookBeforeToolCallResult | void> => {
      // Only intercept exec tool
      if (event.toolName !== 'exec') {
        return;
      }

      const command = extractCommandString(event.params);
      if (!command) {
        return;
      }

      // Extract aliyun CLI commands from the command
      const aliyunCommands = extractAliyunCommands(command);
      if (aliyunCommands.length === 0) {
        return;
      }

      const aliyunCommandStr = joinAliyunCommands(aliyunCommands);

      // Call risk control API
      const sessionId = ctx.sessionKey || '';
      const agentId = ctx.agentId || (api.config as { agentId?: string })?.agentId || 'unknown';

      const hitlResult = await checkHitlRule(aliyunCommandStr, sessionId, agentId, api.logger);
      api.logger.info(`[hitl] Risk decision: ${hitlResult.decision}`);

      // ALLOW: pass through
      if (hitlResult.decision === 'ALLOW') {
        return;
      }

      // DENY: reject (could be API failure or actual risk control denial)
      if (hitlResult.decision === 'DENY') {
        const isComposite = aliyunCommandStr !== command;
        
        // Check if this is an API failure (fail-close policy)
        if (!hitlResult.success) {
          api.logger.warn(`[hitl] API failure: ${hitlResult.error?.slice(0, 200)}`);
          return {
            block: true,
            blockReason: hitlResult.error || 'Risk control API call failed',
          };
        }
        
        // Normal risk control denial
        return {
          block: true,
          blockReason: [
            `⛔ **Operation Denied by Risk Control**`,
            '',
            ...(isComposite ? [
              `⚠️ **Note: Original command is composite, only Alibaba Cloud CLI part was checked**`,
              '',
              `**Original Command:**`,
              '```',
              command,
              '```',
              '',
            ] : []),
            `**Denied Alibaba Cloud Command:**`,
            '```',
            aliyunCommandStr,
            '```',
            '',
            `**Denial Reason:** ${hitlResult.reason || 'Unknown'}`,
            '',
            `Please contact administrator or adjust the operation.`,
          ].join('\n'),
        };
      }

      // ESCALATE: requires human approval
      if (!hitlResult.approvalRequirements) {
        api.logger.error('[hitl] ESCALATE but no approvalRequirements');
        return {
          block: true,
          blockReason: [
            `⚠️ **Risk Control API Error**`,
            '',
            `The risk control system returned ESCALATE decision but did not provide approval link.`,
            `Please retry later or contact administrator.`,
          ].join('\n'),
        };
      }

      const hitlInfo = {
        authReqId: hitlResult.approvalRequirements.authReqId,
        pollingUrl: hitlResult.approvalRequirements.pollingUrl,
        confirmUrl: hitlResult.approvalRequirements.confirmUrl,
        approvalTimeout: hitlResult.approvalRequirements.approvalTimeout,
        riskLevel: hitlResult.riskLevel || 'Medium',
        reason: hitlResult.reason || 'Requires human confirmation',
      };

      const actionId = store.generateId();

      // Store action (execute full original command after approval)
      store.store({
        id: actionId,
        toolName: event.toolName,
        command,
        params: event.params,
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + hitlInfo.approvalTimeout * 1000,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        riskLevel: hitlInfo.riskLevel,
        message: hitlInfo.reason,
        hitl: hitlInfo,
      });

      // Start background polling
      const storedAction = store.get(actionId);
      if (storedAction) {
        startPolling(storedAction, api);
      }

      // Return interception info
      const timeoutMin = Math.floor(hitlInfo.approvalTimeout / 60);
      const isMain = isMainChannel(ctx.sessionKey);
      const isDingtalk = isDingtalkChannel(ctx.sessionKey);
      const isComposite = aliyunCommandStr !== command;

      // Generate approval link based on channel type
      let approvalLink: string;
      if (isMain) {
        // Main channel and Feishu channel: use original link directly
        approvalLink = `👉 [Click here to complete approval](${hitlInfo.confirmUrl})`;
      } else if (isDingtalk) {
        // DingTalk channel: use DingTalk deep link
        approvalLink = `👉 [Click here to complete approval](dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(hitlInfo.confirmUrl)}&pc_slide=true)`;
      } else {
        // Other channels: use original link
        approvalLink = `👉 [Click here to complete approval](${hitlInfo.confirmUrl})`;
      }

      return {
        block: true,
        blockReason: [
          `⚠️ **This operation requires human approval** [${hitlInfo.riskLevel.toUpperCase()}]`,
          '',
          ...(isComposite ? [
            `📝 **Note: Original command is composite. Approval only applies to Alibaba Cloud CLI part. Full command will execute after approval.**`,
            '',
            `**Original Command:**`,
            '```',
            command,
            '```',
            '',
            `**Alibaba Cloud Command Pending Approval:**`,
            '```',
            aliyunCommandStr,
            '```',
          ] : [
            `**Command Pending Approval:**`,
            '```',
            command,
            '```',
          ]),
          '',
          `**Risk Reason:** ${hitlInfo.reason}`,
          '',
          `**Please click the link below to complete approval:**`,
          approvalLink,
          '',
          `✅ After approval, the command will execute automatically.`,
          `❌ After rejection, the command will be cancelled.`,
          '',
          `⏱️ Approval timeout: ${timeoutMin} minutes`,
          '',
          `---`,
          `**Important: Please only display the above approval information, then stop. Do not predict, describe, or assume command execution results. Wait for user approval.**`,
        ].join('\n'),
      };
    },
    { name: 'alibaba-cloud-hitl-before-tool-call' },
  );
}

export function unregister(): void {
  clearPollingActions();
  destroyActionStore();
  clearOriginalTargetCache();
}
