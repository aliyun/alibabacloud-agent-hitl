/**
 * Channel 解析和消息分发模块
 */

import type { ChannelInfo, OpenClawPluginApi } from './types.js';

// ============================================================================
// Channel 解析
// ============================================================================

/**
 * 判断是否主渠道
 * 主渠道 sessionKey 以 :main 结尾，如 agent:main:main
 */
export function isMainChannel(sessionKey?: string): boolean {
  return sessionKey?.endsWith(':main') ?? false;
}

/**
 * 判断是否钉钉渠道
 */
export function isDingtalkChannel(sessionKey?: string): boolean {
  return sessionKey?.includes(':dingtalk') ?? false;
}

/**
 * 解析 sessionKey 获取渠道信息
 * sessionKey 格式示例：
 * - 主渠道: agent:main:main
 * - 钉钉群: agent:main:dingtalk:group:cidXXXXX
 * - 钉钉私聊: agent:main:dingtalk:user:userIdXXX
 * - 飞书: agent:main:feishu:group:xxx
 */
export function parseChannelFromSessionKey(sessionKey?: string): ChannelInfo {
  if (!sessionKey) {
    return { channel: 'unknown', type: 'unknown', target: '' };
  }

  if (sessionKey.endsWith(':main')) {
    return { channel: 'main', type: 'unknown', target: '' };
  }

  const parts = sessionKey.split(':');
  // 格式: agent:main:dingtalk-connector:direct:userId (单聊)
  // 格式: agent:main:dingtalk-connector:group:cidXXXXX (群聊)
  // 索引:   0    1      2          3      4+

  if (parts.length >= 5) {
    const channelName = parts[2];
    
    // 支持 dingtalk, dingtalk-connector, feishu, feishu-connector 等
    const isDingtalk = channelName === 'dingtalk' || channelName === 'dingtalk-connector';
    const isFeishu = channelName === 'feishu' || channelName === 'feishu-connector';
    
    if (isDingtalk || isFeishu) {
      // 检查是否有 accountId（parts[3] 不是 group/user/direct 时）
      let accountId: string | undefined;
      let typeIndex = 3;
      let targetIndex = 4;
      
      if (parts[3] !== 'group' && parts[3] !== 'user' && parts[3] !== 'direct') {
        accountId = parts[3];
        typeIndex = 4;
        targetIndex = 5;
      }
      
      const rawType = parts[typeIndex];
      const type = rawType === 'direct' ? 'user' : rawType as 'group' | 'user';
      const target = parts.slice(targetIndex).join(':');

      return {
        channel: isDingtalk ? 'dingtalk' : 'feishu',
        type: type === 'group' || type === 'user' ? type : 'unknown',
        target,
        accountId,
        rawChannelName: channelName,
      };
    }
  }

  return { channel: 'unknown', type: 'unknown', target: '' };
}

// ============================================================================
// 消息分发
// ============================================================================

// 队列机制：确保同一 sessionKey 的请求串行执行，避免并发问题
const dispatchQueues = new Map<string, Promise<void>>();

/**
 * 通知 Agent 继续执行
 * 使用 dispatchReplyFromConfig 统一处理所有渠道
 */
export async function dispatchToAgent(
  sessionKey: string,
  message: string,
  api: OpenClawPluginApi,
): Promise<void> {
  const currentQueue = dispatchQueues.get(sessionKey) || Promise.resolve();
  
  const newQueue = currentQueue
    .then(() => dispatchToAgentInternal(sessionKey, message, api))
    .catch((err) => {
      api.logger.error(`[hitl] dispatchToAgent 队列执行失败: ${String(err)}`);
    })
    .finally(() => {
      if (dispatchQueues.get(sessionKey) === newQueue) {
        dispatchQueues.delete(sessionKey);
      }
    });
  
  dispatchQueues.set(sessionKey, newQueue);
  
  return newQueue;
}

/**
 * 实际的分发逻辑
 * 
 * 使用 dispatchReplyFromConfig 统一处理所有渠道：
 * - 通过设置 OriginatingChannel 和 OriginatingTo，OpenClaw 会自动路由到对应渠道
 */
async function dispatchToAgentInternal(
  sessionKey: string,
  message: string,
  api: OpenClawPluginApi,
): Promise<void> {
  const channelInfo = parseChannelFromSessionKey(sessionKey);
  
  api.logger.info(`[hitl] dispatchToAgentInternal: sessionKey=${sessionKey}`);
  api.logger.info(`[hitl] channelInfo: ${JSON.stringify(channelInfo)}`);

  try {
    // 构建上下文，根据渠道类型设置不同的路由参数
    const ctxParams: Record<string, unknown> = {
      Body: message,
      BodyForAgent: message,
      RawBody: message,
      CommandBody: message,
      SessionKey: sessionKey,
      CommandAuthorized: true,
      Timestamp: Date.now(),
    };

    // 根据渠道类型设置路由参数
    if ((channelInfo.channel === 'dingtalk' || channelInfo.channel === 'feishu') && channelInfo.target) {
      // 钉钉/飞书渠道：
      // Provider/Surface 设为 webchat，让 shouldRouteToOriginating 为 true
      // 通过 OriginatingChannel/OriginatingTo 指定目标渠道
      const defaultConnector = channelInfo.channel === 'dingtalk' ? 'dingtalk-connector' : 'feishu-connector';
      
      ctxParams.Provider = 'webchat';
      ctxParams.Surface = 'webchat';
      ctxParams.ExplicitDeliverRoute = true;
      ctxParams.OriginatingChannel = channelInfo.rawChannelName || defaultConnector;
      ctxParams.OriginatingTo = channelInfo.target;
      if (channelInfo.accountId) {
        ctxParams.AccountId = channelInfo.accountId;
      }
      ctxParams.ChatType = channelInfo.type === 'group' ? 'group' : 'direct';
      
      api.logger.info(`[hitl] 外部渠道路由: channel=${channelInfo.channel}, OriginatingChannel=${ctxParams.OriginatingChannel}, OriginatingTo=${channelInfo.target}`);
    } else {
      // 主渠道/其他渠道：设置为 webchat
      ctxParams.Provider = 'webchat';
      ctxParams.Surface = 'webchat';
      api.logger.info(`[hitl] 主渠道路由: Provider=webchat, Surface=webchat`);
    }

    const ctx = api.runtime.channel.reply.finalizeInboundContext(ctxParams);
    api.logger.info(`[hitl] finalizedContext: Provider=${ctx.Provider}, Surface=${ctx.Surface}, OriginatingChannel=${ctx.OriginatingChannel}, OriginatingTo=${ctx.OriginatingTo}`);

    const simpleDispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: () => true,
      waitForIdle: async () => {},
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {},
    };

    api.logger.info(`[hitl] 调用 dispatchReplyFromConfig...`);
    const result = await api.runtime.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg: api.config,
      dispatcher: simpleDispatcher,
      replyOptions: {
        onCompactionStart: () => {},
      },
    });
    api.logger.info(`[hitl] dispatchReplyFromConfig 返回: queuedFinal=${result.queuedFinal}, counts=${JSON.stringify(result.counts)}`);

    simpleDispatcher.markComplete();
    await simpleDispatcher.waitForIdle();

    api.logger.info(`[hitl] dispatchToAgentInternal: 消息分发完成, sessionKey=${sessionKey}`);
  } catch (err) {
    api.logger.error(`[hitl] dispatchToAgentInternal 失败: ${String(err)}`);
    if (err instanceof Error) {
      api.logger.error(`[hitl] Error stack: ${err.stack}`);
    }
  }
}
