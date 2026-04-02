/**
 * Channel Parsing and Message Dispatch Module
 */

import type { ChannelInfo, OpenClawPluginApi } from './types.js';

// ============================================================================
// Channel Parsing
// ============================================================================

/**
 * Check if main channel
 * Main channel sessionKey ends with :main, e.g., agent:main:main
 */
export function isMainChannel(sessionKey?: string): boolean {
  return sessionKey?.endsWith(':main') ?? false;
}

/**
 * Check if DingTalk channel
 */
export function isDingtalkChannel(sessionKey?: string): boolean {
  return sessionKey?.includes(':dingtalk') ?? false;
}

/**
 * Parse sessionKey to get channel info
 * sessionKey format examples:
 * - Main channel: agent:main:main
 * - DingTalk group: agent:main:dingtalk:group:cidXXXXX
 * - DingTalk DM: agent:main:dingtalk:user:userIdXXX
 * - Feishu: agent:main:feishu:group:xxx
 */
export function parseChannelFromSessionKey(sessionKey?: string): ChannelInfo {
  if (!sessionKey) {
    return { channel: 'unknown', type: 'unknown', target: '' };
  }

  if (sessionKey.endsWith(':main')) {
    return { channel: 'main', type: 'unknown', target: '' };
  }

  const parts = sessionKey.split(':');
  // Generic format: agent:main:{channelName}:{type}:{target}
  // With accountId: agent:main:{channelName}:{accountId}:{type}:{target}
  // Index:           0    1      2              3         4      5+

  if (parts.length >= 5) {
    const channelName = parts[2];
    
    // Check for accountId (when parts[3] is not group/user/direct)
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
    
    // Normalize channel name for known channels
    let normalizedChannel: 'dingtalk' | 'feishu' | 'main' | 'unknown' = 'unknown';
    if (channelName === 'dingtalk' || channelName === 'dingtalk-connector') {
      normalizedChannel = 'dingtalk';
    } else if (channelName === 'feishu' || channelName === 'feishu-connector') {
      normalizedChannel = 'feishu';
    }

    return {
      channel: normalizedChannel,
      type: type === 'group' || type === 'user' ? type : 'unknown',
      target,
      accountId,
      rawChannelName: channelName,  // Always preserve raw channel name for routing
    };
  }

  return { channel: 'unknown', type: 'unknown', target: '' };
}

// ============================================================================
// Message Dispatch
// ============================================================================

// Queue mechanism: ensure requests for same sessionKey execute serially to avoid concurrency issues
const dispatchQueues = new Map<string, Promise<void>>();

/**
 * Notify Agent to continue execution
 * Uses dispatchReplyFromConfig to handle all channels uniformly
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
      api.logger.error(`[hitl] dispatchToAgent queue execution failed: ${String(err)}`);
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
 * Actual dispatch logic
 * 
 * Uses dispatchReplyFromConfig to handle all channels uniformly:
 * - By setting OriginatingChannel and OriginatingTo, OpenClaw will auto-route to corresponding channel
 */
async function dispatchToAgentInternal(
  sessionKey: string,
  message: string,
  api: OpenClawPluginApi,
): Promise<void> {
  const channelInfo = parseChannelFromSessionKey(sessionKey);
  
  api.logger.info(`[hitl] ========== dispatchToAgentInternal START ==========`);
  api.logger.info(`[hitl] sessionKey: ${sessionKey}`);
  api.logger.info(`[hitl] sessionKey length: ${sessionKey.length}`);
  api.logger.info(`[hitl] channelInfo: ${JSON.stringify(channelInfo, null, 2)}`);
  
  // Debug: Check for special characters in target
  if (channelInfo.target) {
    const hasPlus = channelInfo.target.includes('+');
    const hasEquals = channelInfo.target.includes('=');
    const hasSlash = channelInfo.target.includes('/');
    api.logger.info(`[hitl] target special chars: hasPlus=${hasPlus}, hasEquals=${hasEquals}, hasSlash=${hasSlash}`);
    api.logger.info(`[hitl] target raw bytes: ${Buffer.from(channelInfo.target).toString('hex')}`);
  }

  try {
    // Build context with different routing params based on channel type
    const ctxParams: Record<string, unknown> = {
      Body: message,
      BodyForAgent: message,
      RawBody: message,
      CommandBody: message,
      SessionKey: sessionKey,
      CommandAuthorized: true,
      Timestamp: Date.now(),
    };

    // Set routing params: route back to the original channel
    if (channelInfo.rawChannelName && channelInfo.target) {
      // External channel: use webchat as Provider/Surface, route via OriginatingChannel/OriginatingTo
      ctxParams.Provider = 'webchat';
      ctxParams.Surface = 'webchat';
      ctxParams.ExplicitDeliverRoute = true;
      ctxParams.OriginatingChannel = channelInfo.rawChannelName;
      ctxParams.OriginatingTo = channelInfo.target;
      if (channelInfo.accountId) {
        ctxParams.AccountId = channelInfo.accountId;
      }
      ctxParams.ChatType = channelInfo.type === 'group' ? 'group' : 'direct';
      
      api.logger.info(`[hitl] Routing back to ${channelInfo.rawChannelName}: target=${channelInfo.target}`);
    } else {
      // Main channel or unknown: use webchat
      ctxParams.Provider = 'webchat';
      ctxParams.Surface = 'webchat';
      api.logger.info(`[hitl] Routing to webchat (main channel)`);
    }

    // Log full ctxParams before finalization
    api.logger.info(`[hitl] ctxParams BEFORE finalize: ${JSON.stringify({
      Provider: ctxParams.Provider,
      Surface: ctxParams.Surface,
      ExplicitDeliverRoute: ctxParams.ExplicitDeliverRoute,
      OriginatingChannel: ctxParams.OriginatingChannel,
      OriginatingTo: ctxParams.OriginatingTo,
      AccountId: ctxParams.AccountId,
      ChatType: ctxParams.ChatType,
      SessionKey: ctxParams.SessionKey,
    }, null, 2)}`);

    const ctx = api.runtime.channel.reply.finalizeInboundContext(ctxParams);
    
    // Log full ctx after finalization
    api.logger.info(`[hitl] ctx AFTER finalize: ${JSON.stringify({
      Provider: ctx.Provider,
      Surface: ctx.Surface,
      ExplicitDeliverRoute: ctx.ExplicitDeliverRoute,
      OriginatingChannel: ctx.OriginatingChannel,
      OriginatingTo: ctx.OriginatingTo,
      AccountId: ctx.AccountId,
      ChatType: ctx.ChatType,
      SessionKey: ctx.SessionKey,
    }, null, 2)}`);
    
    // Compare OriginatingTo before and after
    const origToBeforeStr = String(ctxParams.OriginatingTo || '');
    const origToAfterStr = String(ctx.OriginatingTo || '');
    if (origToBeforeStr !== origToAfterStr) {
      api.logger.warn(`[hitl] ⚠️ OriginatingTo CHANGED after finalize!`);
      api.logger.warn(`[hitl]   BEFORE: "${origToBeforeStr}" (len=${origToBeforeStr.length})`);
      api.logger.warn(`[hitl]   AFTER:  "${origToAfterStr}" (len=${origToAfterStr.length})`);
      api.logger.warn(`[hitl]   BEFORE hex: ${Buffer.from(origToBeforeStr).toString('hex')}`);
      api.logger.warn(`[hitl]   AFTER hex:  ${Buffer.from(origToAfterStr).toString('hex')}`);
    } else {
      api.logger.info(`[hitl] ✓ OriginatingTo unchanged after finalize: "${origToAfterStr}"`);
    }

    const simpleDispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: () => true,
      waitForIdle: async () => {},
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {},
    };

    api.logger.info(`[hitl] Calling dispatchReplyFromConfig...`);
    const result = await api.runtime.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg: api.config,
      dispatcher: simpleDispatcher,
      replyOptions: {
        onCompactionStart: () => {},
      },
    });
    api.logger.info(`[hitl] dispatchReplyFromConfig result: ${JSON.stringify(result, null, 2)}`);

    simpleDispatcher.markComplete();
    await simpleDispatcher.waitForIdle();

    api.logger.info(`[hitl] ========== dispatchToAgentInternal END (success) ==========`);
  } catch (err) {
    api.logger.error(`[hitl] ========== dispatchToAgentInternal END (error) ==========`);
    api.logger.error(`[hitl] Error: ${String(err)}`);
    if (err instanceof Error) {
      api.logger.error(`[hitl] Stack: ${err.stack}`);
    }
  }
}
