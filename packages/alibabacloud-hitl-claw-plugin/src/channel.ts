/**
 * Channel Parsing and Message Dispatch Module
 */

import type { ChannelInfo, OpenClawPluginApi } from './types.js';

// ============================================================================
// Original ConversationId Cache
// ============================================================================

// Cache to store original conversationId (preserving case) keyed by "channelId:lowercaseConversationId"
// This is needed because sessionKey converts the target to lowercase, but DingTalk API needs original case
const originalTargetCache = new Map<string, string>();

/**
 * Cache the original conversationId
 * @param cacheKey - Format: "channelId:lowercaseConversationId"
 * @param originalConversationId - Original conversationId with correct case
 */
export function cacheOriginalTarget(cacheKey: string, originalConversationId: string): void {
  if (!cacheKey || !originalConversationId) return;
  originalTargetCache.set(cacheKey, originalConversationId);
}

/**
 * Get the cached original conversationId, or fall back to the sessionKey target
 */
export function getOriginalTarget(channelInfo: ChannelInfo): string {
  if (!channelInfo.rawChannelName || !channelInfo.target) {
    return channelInfo.target;
  }
  
  // Build cache key: channelId (rawChannelName) + lowercase target
  const cacheKey = `${channelInfo.rawChannelName}:${channelInfo.target.toLowerCase()}`;
  return originalTargetCache.get(cacheKey) || channelInfo.target;
}

/**
 * Clear all cached targets (for cleanup)
 */
export function clearOriginalTargetCache(): void {
  originalTargetCache.clear();
}

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
  
  // Get original target (with correct case) from cache, or fall back to sessionKey target
  const originalTarget = getOriginalTarget(channelInfo);

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
    if (channelInfo.rawChannelName && originalTarget) {
      // External channel: use webchat as Provider/Surface, route via OriginatingChannel/OriginatingTo
      ctxParams.Provider = 'webchat';
      ctxParams.Surface = 'webchat';
      ctxParams.ExplicitDeliverRoute = true;
      ctxParams.OriginatingChannel = channelInfo.rawChannelName;
      ctxParams.OriginatingTo = originalTarget;  // Use original target with correct case
      if (channelInfo.accountId) {
        ctxParams.AccountId = channelInfo.accountId;
      }
      ctxParams.ChatType = channelInfo.type === 'group' ? 'group' : 'direct';
      
      api.logger.info(`[hitl] Routing to ${channelInfo.rawChannelName}:${originalTarget} (${channelInfo.type})`);
    } else {
      // Main channel or unknown: use webchat
      ctxParams.Provider = 'webchat';
      ctxParams.Surface = 'webchat';
      api.logger.info(`[hitl] Routing to webchat (main channel)`);
    }

    const ctx = api.runtime.channel.reply.finalizeInboundContext(ctxParams);

    const simpleDispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: () => true,
      waitForIdle: async () => {},
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {},
    };

    const result = await api.runtime.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg: api.config,
      dispatcher: simpleDispatcher,
      replyOptions: {
        onCompactionStart: () => {},
      },
    });

    simpleDispatcher.markComplete();
    await simpleDispatcher.waitForIdle();

    if (result.queuedFinal) {
      api.logger.info(`[hitl] Message dispatched successfully`);
    } else {
      api.logger.warn(`[hitl] Message dispatch: queuedFinal=${result.queuedFinal}`);
    }
  } catch (err) {
    api.logger.error(`[hitl] Dispatch failed: ${String(err)}`);
    if (err instanceof Error) {
      api.logger.error(`[hitl] Stack: ${err.stack}`);
    }
  }
}
