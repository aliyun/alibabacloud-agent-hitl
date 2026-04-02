/**
 * OpenClaw Tool Interceptor Plugin - Type Definitions
 */

// ============================================================================
// Plugin Configuration Types
// ============================================================================

export interface PluginConfig {
  /** Enable or disable the plugin */
  enabled: boolean;
  /** Timeout for user confirmation in seconds */
  confirmationTimeoutSeconds: number;
}

// ============================================================================
// Action Types
// ============================================================================

export interface HitlInfo {
  authReqId: string;       // Approval request ID
  pollingUrl: string;      // Polling URL
  confirmUrl: string;      // User confirmation link
  approvalTimeout: number; // Timeout in seconds
  riskLevel: string;       // Risk level returned by risk control
  reason: string;          // Reason returned by risk control
}

export interface PendingAction {
  id: string;
  toolName: string;
  command: string;
  params: Record<string, unknown>;
  createdAtMs: number;
  expiresAtMs: number;
  sessionKey?: string;
  agentId?: string;
  riskLevel: string;
  message: string;
  hitl?: HitlInfo;
}

// ============================================================================
// Channel Types
// ============================================================================

export interface ChannelInfo {
  channel: 'dingtalk' | 'feishu' | 'main' | 'unknown';
  type: 'group' | 'user' | 'unknown';
  target: string;  // conversationId or userId
  accountId?: string;
  rawChannelName?: string;  // Original channel name, e.g., 'dingtalk-connector'
}

// ============================================================================
// HITL Types
// ============================================================================

export interface HitlCheckResult {
  success: boolean;
  decision: 'ALLOW' | 'ESCALATE' | 'DENY';
  approvalRequirements?: {
    authReqId: string;
    confirmUrl: string;
    pollingUrl: string;
    approvalTimeout: number;
    confirmationPrompt: string;
  };
  riskLevel?: string;
  reason?: string;
  error?: string;
}

export type PollStatus = 'pending' | 'success' | 'failed' | 'unknown';

export interface PollResult {
  status: PollStatus;
  hitlToken?: string;
  delayMs?: number;  // Delay time for next poll (milliseconds)
}

// ============================================================================
// OpenClaw Plugin API Types
// ============================================================================

export interface PluginHookBeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

export interface PluginHookToolContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
}

export interface PluginHookBeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

export interface PluginHookMessageReceivedEvent {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface PluginHookMessageContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
}

export interface Logger {
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
  debug: (msg: string, meta?: unknown) => void;
}

export interface Dispatcher {
  sendToolResult: (payload: unknown) => boolean;
  sendBlockReply: (payload: unknown) => boolean;
  sendFinalReply: (payload: unknown) => boolean;
  waitForIdle: () => Promise<void>;
  getQueuedCounts: () => Record<string, number>;
  markComplete: () => void;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  runtime: {
    subagent: {
      run: (params: {
        sessionKey: string;
        message: string;
        provider?: string;
        model?: string;
        extraSystemPrompt?: string;
        lane?: string;
        deliver?: boolean;
        idempotencyKey?: string;
      }) => Promise<{ runId: string }>;
    };
    channel: {
      reply: {
        finalizeInboundContext: (ctx: Record<string, unknown>) => Record<string, unknown>;
        dispatchReplyFromConfig: (params: {
          ctx: Record<string, unknown>;
          cfg: unknown;
          dispatcher: Dispatcher;
          replyOptions?: Record<string, unknown>;
        }) => Promise<{ queuedFinal: boolean; counts: Record<string, number> }>;
        withReplyDispatcher: <T>(params: {
          dispatcher: unknown;
          onSettled?: () => void;
          run: () => Promise<T>;
        }) => Promise<T>;
      };
    };
  };
  logger: Logger;
  on: {
    (
      hookName: 'before_tool_call',
      handler: (
        event: PluginHookBeforeToolCallEvent,
        ctx: PluginHookToolContext,
      ) => Promise<PluginHookBeforeToolCallResult | void> | PluginHookBeforeToolCallResult | void,
      opts?: { priority?: number; name?: string },
    ): void;
    (
      hookName: 'message_received',
      handler: (
        event: PluginHookMessageReceivedEvent,
        ctx: PluginHookMessageContext,
      ) => Promise<void> | void,
      opts?: { priority?: number; name?: string },
    ): void;
  };
}
