/**
 * channel.ts 测试
 * 测试 conversationId 缓存和渠道解析功能
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  cacheOriginalConversationId,
  getOriginalConversationId,
  clearConversationIdCache,
  isMainChannel,
  isDingtalkChannel,
  parseChannelFromSessionKey,
} from '../src/channel.js';

describe('conversationId 缓存', () => {
  beforeEach(() => {
    clearConversationIdCache();
  });

  it('缓存混合大小写的 conversationId', () => {
    cacheOriginalConversationId('Cid9Ny3Fb+D+1LksF2sn7gjEQ==');
    expect(getOriginalConversationId('cid9ny3fb+d+1lksf2sn7gjeq==')).toBe('Cid9Ny3Fb+D+1LksF2sn7gjEQ==');
  });

  it('全小写的 conversationId 不会被缓存', () => {
    cacheOriginalConversationId('alllowercase');
    expect(getOriginalConversationId('alllowercase')).toBe('alllowercase');
  });

  it('缓存未命中时返回原值', () => {
    expect(getOriginalConversationId('unknown-id')).toBe('unknown-id');
  });

  it('不缓存空值', () => {
    cacheOriginalConversationId(undefined);
    cacheOriginalConversationId('');
    expect(getOriginalConversationId('')).toBe('');
  });

  it('clearConversationIdCache 清空缓存', () => {
    cacheOriginalConversationId('Cid9Ny3Fb+D+1LksF2sn7gjEQ==');
    clearConversationIdCache();
    expect(getOriginalConversationId('cid9ny3fb+d+1lksf2sn7gjeq==')).toBe('cid9ny3fb+d+1lksf2sn7gjeq==');
  });

  it('缓存有上限（LRU 淘汰）', () => {
    // 填充缓存到接近上限
    for (let i = 0; i < 1001; i++) {
      cacheOriginalConversationId(`CacheTest${i}ID`);
    }
    // 第一个应该被淘汰
    expect(getOriginalConversationId('cachetest0id')).toBe('cachetest0id');
    // 最后一个应该还在
    expect(getOriginalConversationId('cachetest1000id')).toBe('CacheTest1000ID');
  });
});

describe('isMainChannel', () => {
  it('识别主渠道', () => {
    expect(isMainChannel('agent:main:main')).toBe(true);
    expect(isMainChannel('something:main')).toBe(true);
  });

  it('识别非主渠道', () => {
    expect(isMainChannel('agent:main:dingtalk:group:cid123')).toBe(false);
    expect(isMainChannel('agent:main:feishu:group:xxx')).toBe(false);
  });

  it('处理 undefined', () => {
    expect(isMainChannel(undefined)).toBe(false);
  });
});

describe('isDingtalkChannel', () => {
  it('识别钉钉渠道', () => {
    expect(isDingtalkChannel('agent:main:dingtalk:group:cid123')).toBe(true);
    expect(isDingtalkChannel('agent:main:dingtalk-connector:group:cid123')).toBe(true);
  });

  it('识别非钉钉渠道', () => {
    expect(isDingtalkChannel('agent:main:feishu:group:xxx')).toBe(false);
    expect(isDingtalkChannel('agent:main:main')).toBe(false);
  });

  it('处理 undefined', () => {
    expect(isDingtalkChannel(undefined)).toBe(false);
  });
});

describe('parseChannelFromSessionKey', () => {
  describe('主渠道', () => {
    it('解析主渠道', () => {
      const result = parseChannelFromSessionKey('agent:main:main');
      expect(result).toEqual({ channel: 'main', type: 'unknown', target: '' });
    });
  });

  describe('钉钉渠道', () => {
    it('解析钉钉群聊（dingtalk-connector）', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk-connector:group:cid9ny3fb+d+1lksf2sn7gjeq==');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'group',
        target: 'cid9ny3fb+d+1lksf2sn7gjeq==',
        accountId: undefined,
        rawChannelName: 'dingtalk-connector',
      });
    });

    it('解析钉钉单聊（direct -> user）', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk-connector:direct:user123');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'user',
        target: 'user123',
        accountId: undefined,
        rawChannelName: 'dingtalk-connector',
      });
    });

    it('解析钉钉旧格式（dingtalk）', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk:group:cidXXX');
      expect(result).toEqual({
        channel: 'dingtalk',
        type: 'group',
        target: 'cidXXX',
        accountId: undefined,
        rawChannelName: 'dingtalk',
      });
    });

    it('解析带 accountId 的钉钉渠道', () => {
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

  describe('飞书渠道', () => {
    it('解析飞书群聊', () => {
      const result = parseChannelFromSessionKey('agent:main:feishu:group:oc_xxx123');
      expect(result).toEqual({
        channel: 'feishu',
        type: 'group',
        target: 'oc_xxx123',
        accountId: undefined,
        rawChannelName: 'feishu',
      });
    });

    it('解析 feishu-connector', () => {
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

  describe('边界情况', () => {
    it('处理 undefined', () => {
      const result = parseChannelFromSessionKey(undefined);
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('处理空字符串', () => {
      const result = parseChannelFromSessionKey('');
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('处理未知渠道', () => {
      const result = parseChannelFromSessionKey('agent:main:unknown:group:xxx');
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('处理不完整的 sessionKey', () => {
      const result = parseChannelFromSessionKey('agent:main:dingtalk');
      expect(result).toEqual({ channel: 'unknown', type: 'unknown', target: '' });
    });

    it('处理带冒号的 target', () => {
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
