/**
 * OpenClaw Alibaba Cloud HITL Interceptor Plugin
 *
 * 拦截阿里云 CLI 命令，通过风控 API 检测敏感操作，实现人工审批流程。
 *
 * 流程：
 * 1. Agent 调用 exec 工具 → 插件拦截
 * 2. 调用风控 API 检测命令风险 → ALLOW/DENY/ESCALATE
 * 3. ESCALATE 时存储命令，启动审批轮询
 * 4. 用户审批通过 → 执行命令，通知 Agent 继续
 */

import type {
  OpenClawPluginApi,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
  PluginHookBeforeToolCallResult,
} from './types.js';
import { getActionStore, destroyActionStore } from './action-store.js';
import { loadConfig } from './config.js';
import { extractCommandString, extractAliyunCommands, joinAliyunCommands } from './rules.js';
import { checkHitlRule, startPolling, clearPollingActions } from './hitl.js';
import { isMainChannel, isDingtalkChannel } from './channel.js';

// ============================================================================
// 插件入口
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
  // 注册 before_tool_call 钩子（核心拦截逻辑）
  // -------------------------------------------------------------------------
  api.on(
    'before_tool_call',
    async (
      event: PluginHookBeforeToolCallEvent,
      ctx: PluginHookToolContext,
    ): Promise<PluginHookBeforeToolCallResult | void> => {
      // 只拦截 exec 工具
      if (event.toolName !== 'exec') {
        return;
      }

      const command = extractCommandString(event.params);
      if (!command) {
        return;
      }

      // 从命令中提取 aliyun CLI 命令
      const aliyunCommands = extractAliyunCommands(command);
      if (aliyunCommands.length === 0) {
        return;
      }

      const aliyunCommandStr = joinAliyunCommands(aliyunCommands);

      // 调用风控 API
      const sessionId = ctx.sessionKey || '';
      const agentId = ctx.agentId || (api.config as { agentId?: string })?.agentId || 'unknown';

      const hitlResult = await checkHitlRule(aliyunCommandStr, sessionId, agentId, api.logger);
      api.logger.info(`[hitl] Risk decision: ${hitlResult.decision}`);

      // ALLOW: 放行
      if (hitlResult.decision === 'ALLOW') {
        return;
      }

      // DENY: 拒绝
      if (hitlResult.decision === 'DENY') {
        const isComposite = aliyunCommandStr !== command;
        return {
          block: true,
          blockReason: [
            `⛔ **操作已被风控拒绝**`,
            '',
            ...(isComposite ? [
              `⚠️ **注意：原始命令为复合命令，风控只检测阿里云 CLI 部分**`,
              '',
              `**原始命令:**`,
              '```',
              command,
              '```',
              '',
            ] : []),
            `**被拒绝的阿里云命令:**`,
            '```',
            aliyunCommandStr,
            '```',
            '',
            `**拒绝原因:** ${hitlResult.reason || '未知'}`,
            '',
            `请联系管理员或调整操作。`,
          ].join('\n'),
        };
      }

      // ESCALATE: 需要人工审批
      if (!hitlResult.approvalRequirements) {
        api.logger.error('[hitl] ESCALATE but no approvalRequirements');
        return {
          block: true,
          blockReason: [
            `⚠️ **风控 API 异常**`,
            '',
            `风控系统返回了 ESCALATE 决策，但未提供审批链接。`,
            `请稍后重试或联系管理员。`,
          ].join('\n'),
        };
      }

      const hitlInfo = {
        authReqId: hitlResult.approvalRequirements.authReqId,
        pollingUrl: hitlResult.approvalRequirements.pollingUrl,
        confirmUrl: hitlResult.approvalRequirements.confirmUrl,
        approvalTimeout: hitlResult.approvalRequirements.approvalTimeout,
        riskLevel: hitlResult.riskLevel || 'Medium',
        reason: hitlResult.reason || '需要人工确认',
      };

      const actionId = store.generateId();

      // 存储 action（审批后执行完整原始命令）
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

      // 启动后台轮询
      const storedAction = store.get(actionId);
      if (storedAction) {
        startPolling(storedAction, api);
      }

      // 返回拦截信息
      const timeoutMin = Math.floor(hitlInfo.approvalTimeout / 60);
      const isMain = isMainChannel(ctx.sessionKey);
      const isDingtalk = isDingtalkChannel(ctx.sessionKey);
      const isComposite = aliyunCommandStr !== command;

      // 根据渠道类型生成不同格式的审批链接
      let approvalLink: string;
      if (isMain) {
        // 主渠道和飞书渠道：直接使用原始链接
        approvalLink = `👉 [点击此处完成审批](${hitlInfo.confirmUrl})`;
      } else if (isDingtalk) {
        // 钉钉渠道：使用钉钉深链接
        approvalLink = `👉 [点击此处完成审批](dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(hitlInfo.confirmUrl)}&pc_slide=true)`;
      } else {
        // 其他渠道：使用原始链接
        approvalLink = `👉 [点击此处完成审批](${hitlInfo.confirmUrl})`;
      }

      return {
        block: true,
        blockReason: [
          `⚠️ **此操作需要人工审批** [${hitlInfo.riskLevel.toUpperCase()}]`,
          '',
          ...(isComposite ? [
            `📝 **注意：原始命令为复合命令，审批只针对阿里云 CLI 部分，审批通过后执行完整命令**`,
            '',
            `**原始命令:**`,
            '```',
            command,
            '```',
            '',
            `**待审批的阿里云命令:**`,
            '```',
            aliyunCommandStr,
            '```',
          ] : [
            `**待审批命令:**`,
            '```',
            command,
            '```',
          ]),
          '',
          `**风险原因:** ${hitlInfo.reason}`,
          '',
          `**请点击以下链接完成审批:**`,
          approvalLink,
          '',
          `✅ 审批通过后，命令将自动执行。`,
          `❌ 审批拒绝后，命令将被取消。`,
          '',
          `⏱️ 审批超时时间: ${timeoutMin} 分钟`,
          '',
          `---`,
          `**重要：请只展示以上审批信息，然后停止。不要预测、描述或假设命令执行后的结果。等待用户审批。**`,
        ].join('\n'),
      };
    },
    { name: 'alibaba-cloud-hitl-before-tool-call' },
  );
}

export function unregister(): void {
  clearPollingActions();
  destroyActionStore();
}
