/**
 * channel.ts tests
 * Tests for channel parsing functionality
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  isMainChannel,
  isDingtalkChannel,
  parseChannelFromSessionKey,
  cacheOriginalTarget,
  getOriginalTarget,
  clearOriginalTargetCache,
} from '../src/channel.js';

describe('isMainChannel', () => {
  it('identifies main channel', () => {
    expect(isMainChannel('agent:main:main')).toBe(true);
    expect(isMainChannel('something:main')).toBe(true);
  });

  it('identifies non-main channel', () => {
    expect(isMainChannel('agent:main:dingtalk:group:cid123')).toBe(false);
    expect(isMainChannel('agent:main:feishu:group:xxx')).toBe(false);
  });

  it('handles undefined', () => {
    expect(isMainChannel(undefined)).toBe(false);
  });
});

describe('isDingtalkChannel', () => {
  it('identifies DingTalk channel', () => {
    expect(isDingtalkChannel('agent:main:dingtalk:group:cid123')).toBe(true);
    expect(isDingtalkChannel('agent:main:dingtalk-connector:group:cid123')).toBe(true);
  });

  it('identifies non-DingTalk channel', () => {
    expect(isDingtalkChannel('agent:main:feishu:group:xxx')).toBe(false);
    expect(isDingtalkChannel('agent:main:main')).toBe(false);
  });

  it('handles undefined', () => {
    expect(isDingtalkChannel(undefined)).toBe(false);
  });
});

describe('parseChannelFromSessionKey', () => {
  describe('main channel', () => {
    it('parses main channel', () => {
      const result = parseChannelFromSessionKey('agent:main:main');
      expect(result).toEqual({ channel: 'main', type: 'unknown', target: '' });
    });
  });

  describe('DingTalk channel', () => {
    it('parses DingTalk group (dingtalk-connector)', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk-connector:group:cid9ny3fb+d+1lksf2sn7gjeq==');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'group',
        target: 'cid9ny3fb+d+1lksf2sn7gjeq==',
        accountId: undefined,
        rawChannelName: 'dingtalk-connector',
      });
    });

    it('parses DingTalk DM (direct -> user)', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk-connector:direct:user123');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'user',
        target: 'user123',
        accountId: undefined,
        rawChannelName: 'dingtalk-connector',
      });
    });

    it('parses DingTalk legacy format (dingtalk)', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk:group:cidXXX');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'group',
        target: 'cidXXX',
        accountId: undefined,
        rawChannelName: 'dingtalk',
      });
    });

    it('parses DingTalk channel with accountId', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk-connector:account1:group:cidXXX');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'group',
        target: 'cidXXX',
        accountId: 'account1',
        rawChannelName: 'dingtalk-connector',
      });
    });
  });

  describe('Feishu channel', () => {
    it('parses Feishu group', () => {
      const result = parseChannelFromSessionKey('agent:main:feishu:group:oc_xxx123');
      expect(result).toEqual({
        channel: 'feishu',
        type: 'group',
        target: 'oc_xxx123',
        accountId: undefined,
        rawChannelName: 'feishu',
      });
    });

    it('parses feishu-connector', () => {
      const result = parseChannelFromSessionKey('agent:main:feishu-connector:group:oc_xxx');
      expect(result).toEqual({
        channel: 'feishu',
        type: 'group',
        target: 'oc_xxx',
        accountId: undefined,
        rawChannelName: 'feishu-connector',
      });
    });
  });

  describe('edge cases', () => {
    it('handles undefined', () => {
      const result = parseChannelFromSessionKey(undefined);
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('handles empty string', () => {
      const result = parseChannelFromSessionKey('');
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('handles unknown channel (still parses for routing)', () => {
      const result = parseChannelFromSessionKey('agent:main:unknown:group:xxx');
      expect(result).toEqual({
        channel: 'unknown',
        type: 'group',
        target: 'xxx',
        accountId: undefined,
        rawChannelName: 'unknown',  // Preserved for routing back
      });
    });

    it('handles incomplete sessionKey', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk');
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('handles target with colons', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk-connector:group:cid:with:colons');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'group',
        target: 'cid:with:colons',
        accountId: undefined,
        rawChannelName: 'dingtalk-connector',
      });
    });
  });
});

describe('originalTarget cache', () => {
  beforeEach(() => {
    clearOriginalTargetCache();
  });

  it('caches original target and retrieves it', () => {
    // Simulate: DingTalk sends original case 'cid9Ny3fB+D+1LkSf2Sn7GjEq=='
    // but sessionKey has lowercase 'cid9ny3fb+d+1lksf2sn7gjeq=='
    const channelId = 'dingtalk-connector';
    const originalConversationId = 'cid9Ny3fB+D+1LkSf2Sn7GjEq==';
    const lowercaseKey = `${channelId}:${originalConversationId.toLowerCase()}`;
    
    cacheOriginalTarget(lowercaseKey, originalConversationId);
    
    // When we parse sessionKey, we get lowercase target
    const sessionKey = 'agent:main:dingtalk-connector:group:cid9ny3fb+d+1lksf2sn7gjeq==';
    const channelInfo = parseChannelFromSessionKey(sessionKey);
    const retrieved = getOriginalTarget(channelInfo);
    
    expect(retrieved).toBe(originalConversationId);
  });

  it('returns sessionKey target when no cache exists', () => {
    const sessionKey = 'agent:main:dingtalk-connector:group:cid123';
    
    const channelInfo = parseChannelFromSessionKey(sessionKey);
    const retrieved = getOriginalTarget(channelInfo);
    
    expect(retrieved).toBe('cid123');
  });

  it('handles empty inputs gracefully', () => {
    cacheOriginalTarget('', '');
    
    const channelInfo = parseChannelFromSessionKey('agent:main:main');
    const retrieved = getOriginalTarget(channelInfo);
    
    expect(retrieved).toBe('');
  });

  it('clears cache properly', () => {
    const channelId = 'dingtalk-connector';
    const cacheKey = `${channelId}:cid123`;
    cacheOriginalTarget(cacheKey, 'CID123Original');
    
    clearOriginalTargetCache();
    
    const sessionKey = 'agent:main:dingtalk-connector:group:cid123';
    const channelInfo = parseChannelFromSessionKey(sessionKey);
    const retrieved = getOriginalTarget(channelInfo);
    
    // Should fall back to sessionKey target
    expect(retrieved).toBe('cid123');
  });

  it('handles multiple channels independently', () => {
    cacheOriginalTarget('dingtalk-connector:cid1', 'CID1Original');
    cacheOriginalTarget('dingtalk-connector:cid2', 'CID2Original');
    
    const channelInfo1 = parseChannelFromSessionKey('agent:main:dingtalk-connector:group:cid1');
    const channelInfo2 = parseChannelFromSessionKey('agent:main:dingtalk-connector:group:cid2');
    
    expect(getOriginalTarget(channelInfo1)).toBe('CID1Original');
    expect(getOriginalTarget(channelInfo2)).toBe('CID2Original');
  });
});
