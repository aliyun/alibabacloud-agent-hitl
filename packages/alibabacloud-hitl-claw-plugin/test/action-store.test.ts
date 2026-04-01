/**
 * action-store.ts 测试
 * 测试 ActionStore 类的存储、查询、过期、清理功能
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { ActionStore, getActionStore, destroyActionStore } from '../src/action-store.js';
import type { PendingAction } from '../src/types.js';

function createMockAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 'test-id',
    toolName: 'shell',
    command: 'aliyun ecs DescribeInstances',
    params: {},
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 300_000, // 5 分钟后过期
    sessionKey: 'agent:main:main',
    riskLevel: 'MEDIUM',
    message: '请确认是否执行',
    ...overrides,
  };
}

describe('ActionStore', () => {
  let store: ActionStore;

  beforeEach(() => {
    store = new ActionStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateId', () => {
    it('生成 8 字符的唯一 ID', () => {
      const id = store.generateId();
      expect(id).toHaveLength(8);
    });

    it('每次生成不同的 ID', () => {
      const ids = new Set([store.generateId(), store.generateId(), store.generateId()]);
      expect(ids.size).toBe(3);
    });
  });

  describe('store & get', () => {
    it('存储并获取 action', () => {
      const action = createMockAction({ id: 'action-1' });
      store.store(action);
      
      const retrieved = store.get('action-1');
      expect(retrieved).toEqual(action);
    });

    it('获取不存在的 action 返回 undefined', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });

    it('获取已过期的 action 返回 undefined', () => {
      const action = createMockAction({
        id: 'expired-action',
        expiresAtMs: Date.now() - 1000, // 已过期
      });
      store.store(action);

      expect(store.get('expired-action')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('删除存在的 action 返回 true', () => {
      const action = createMockAction({ id: 'to-delete' });
      store.store(action);
      
      expect(store.delete('to-delete')).toBe(true);
      expect(store.get('to-delete')).toBeUndefined();
    });

    it('删除不存在的 action 返回 false', () => {
      expect(store.delete('non-existent')).toBe(false);
    });
  });

  describe('listPending', () => {
    it('列出所有未过期的 action', () => {
      store.store(createMockAction({ id: 'action-1', createdAtMs: 1000 }));
      store.store(createMockAction({ id: 'action-2', createdAtMs: 2000 }));
      
      const list = store.listPending();
      expect(list).toHaveLength(2);
    });

    it('按创建时间降序排列', () => {
      store.store(createMockAction({ id: 'older', createdAtMs: 1000 }));
      store.store(createMockAction({ id: 'newer', createdAtMs: 2000 }));
      
      const list = store.listPending();
      expect(list[0].id).toBe('newer');
      expect(list[1].id).toBe('older');
    });

    it('自动过滤已过期的 action', () => {
      store.store(createMockAction({ id: 'valid' }));
      store.store(createMockAction({ id: 'expired', expiresAtMs: Date.now() - 1000 }));
      
      const list = store.listPending();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('valid');
    });
  });

  describe('listBySession', () => {
    it('按 sessionKey 筛选 action', () => {
      store.store(createMockAction({ id: 'session1-a', sessionKey: 'session-1' }));
      store.store(createMockAction({ id: 'session1-b', sessionKey: 'session-1' }));
      store.store(createMockAction({ id: 'session2-a', sessionKey: 'session-2' }));
      
      const list = store.listBySession('session-1');
      expect(list).toHaveLength(2);
      expect(list.every(a => a.sessionKey === 'session-1')).toBe(true);
    });

    it('按创建时间升序排列', () => {
      store.store(createMockAction({ id: 'newer', sessionKey: 's1', createdAtMs: 2000 }));
      store.store(createMockAction({ id: 'older', sessionKey: 's1', createdAtMs: 1000 }));
      
      const list = store.listBySession('s1');
      expect(list[0].id).toBe('older');
      expect(list[1].id).toBe('newer');
    });
  });

  describe('takeBySession', () => {
    it('获取并删除指定 session 的所有 action', () => {
      store.store(createMockAction({ id: 'action-1', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'action-2', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'action-3', sessionKey: 'other' }));
      
      const taken = store.takeBySession('target');
      expect(taken).toHaveLength(2);
      
      // 确认已被删除
      expect(store.listBySession('target')).toHaveLength(0);
      // 其他 session 的不受影响
      expect(store.listBySession('other')).toHaveLength(1);
    });
  });

  describe('deleteBySession', () => {
    it('删除指定 session 的所有 action 并返回数量', () => {
      store.store(createMockAction({ id: 'a1', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'a2', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'a3', sessionKey: 'other' }));
      
      const count = store.deleteBySession('target');
      expect(count).toBe(2);
      expect(store.listBySession('target')).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('清理所有过期的 action', () => {
      store.store(createMockAction({ id: 'valid', expiresAtMs: Date.now() + 10000 }));
      store.store(createMockAction({ id: 'expired1', expiresAtMs: Date.now() - 1000 }));
      store.store(createMockAction({ id: 'expired2', expiresAtMs: Date.now() - 2000 }));
      
      store.cleanup();
      
      expect(store.listPending()).toHaveLength(1);
      expect(store.get('valid')).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('清空所有数据', () => {
      store.store(createMockAction({ id: 'a1' }));
      store.store(createMockAction({ id: 'a2' }));
      
      store.destroy();
      
      expect(store.listPending()).toHaveLength(0);
    });
  });
});

describe('Global ActionStore', () => {
  afterEach(() => {
    destroyActionStore();
  });

  it('getActionStore 返回单例', () => {
    const store1 = getActionStore();
    const store2 = getActionStore();
    expect(store1).toBe(store2);
  });

  it('destroyActionStore 销毁单例', () => {
    const store1 = getActionStore();
    store1.store(createMockAction({ id: 'test' }));
    
    destroyActionStore();
    
    const store2 = getActionStore();
    expect(store2).not.toBe(store1);
    expect(store2.listPending()).toHaveLength(0);
  });
});
