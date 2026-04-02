/**
 * action-store.ts tests
 * Tests for ActionStore class storage, query, expiration, and cleanup functionality
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
    expiresAtMs: Date.now() + 300_000, // expires in 5 minutes
    sessionKey: 'agent:main:main',
    riskLevel: 'MEDIUM',
    message: 'Please confirm execution',
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
    it('generates 8-character unique ID', () => {
      const id = store.generateId();
      expect(id).toHaveLength(8);
    });

    it('generates different IDs each time', () => {
      const ids = new Set([store.generateId(), store.generateId(), store.generateId()]);
      expect(ids.size).toBe(3);
    });
  });

  describe('store & get', () => {
    it('stores and retrieves action', () => {
      const action = createMockAction({ id: 'action-1' });
      store.store(action);
      
      const retrieved = store.get('action-1');
      expect(retrieved).toEqual(action);
    });

    it('returns undefined for non-existent action', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });

    it('returns undefined for expired action', () => {
      const action = createMockAction({
        id: 'expired-action',
        expiresAtMs: Date.now() - 1000, // already expired
      });
      store.store(action);

      expect(store.get('expired-action')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('returns true when deleting existing action', () => {
      const action = createMockAction({ id: 'to-delete' });
      store.store(action);
      
      expect(store.delete('to-delete')).toBe(true);
      expect(store.get('to-delete')).toBeUndefined();
    });

    it('returns false when deleting non-existent action', () => {
      expect(store.delete('non-existent')).toBe(false);
    });
  });

  describe('listPending', () => {
    it('lists all non-expired actions', () => {
      store.store(createMockAction({ id: 'action-1', createdAtMs: 1000 }));
      store.store(createMockAction({ id: 'action-2', createdAtMs: 2000 }));
      
      const list = store.listPending();
      expect(list).toHaveLength(2);
    });

    it('sorts by creation time descending', () => {
      store.store(createMockAction({ id: 'older', createdAtMs: 1000 }));
      store.store(createMockAction({ id: 'newer', createdAtMs: 2000 }));
      
      const list = store.listPending();
      expect(list[0].id).toBe('newer');
      expect(list[1].id).toBe('older');
    });

    it('auto-filters expired actions', () => {
      store.store(createMockAction({ id: 'valid' }));
      store.store(createMockAction({ id: 'expired', expiresAtMs: Date.now() - 1000 }));
      
      const list = store.listPending();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('valid');
    });
  });

  describe('listBySession', () => {
    it('filters actions by sessionKey', () => {
      store.store(createMockAction({ id: 'session1-a', sessionKey: 'session-1' }));
      store.store(createMockAction({ id: 'session1-b', sessionKey: 'session-1' }));
      store.store(createMockAction({ id: 'session2-a', sessionKey: 'session-2' }));
      
      const list = store.listBySession('session-1');
      expect(list).toHaveLength(2);
      expect(list.every(a => a.sessionKey === 'session-1')).toBe(true);
    });

    it('sorts by creation time ascending', () => {
      store.store(createMockAction({ id: 'newer', sessionKey: 's1', createdAtMs: 2000 }));
      store.store(createMockAction({ id: 'older', sessionKey: 's1', createdAtMs: 1000 }));
      
      const list = store.listBySession('s1');
      expect(list[0].id).toBe('older');
      expect(list[1].id).toBe('newer');
    });
  });

  describe('takeBySession', () => {
    it('gets and deletes all actions for specified session', () => {
      store.store(createMockAction({ id: 'action-1', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'action-2', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'action-3', sessionKey: 'other' }));
      
      const taken = store.takeBySession('target');
      expect(taken).toHaveLength(2);
      
      // Confirm deleted
      expect(store.listBySession('target')).toHaveLength(0);
      // Other session unaffected
      expect(store.listBySession('other')).toHaveLength(1);
    });
  });

  describe('deleteBySession', () => {
    it('deletes all actions for specified session and returns count', () => {
      store.store(createMockAction({ id: 'a1', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'a2', sessionKey: 'target' }));
      store.store(createMockAction({ id: 'a3', sessionKey: 'other' }));
      
      const count = store.deleteBySession('target');
      expect(count).toBe(2);
      expect(store.listBySession('target')).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('cleans up all expired actions', () => {
      store.store(createMockAction({ id: 'valid', expiresAtMs: Date.now() + 10000 }));
      store.store(createMockAction({ id: 'expired1', expiresAtMs: Date.now() - 1000 }));
      store.store(createMockAction({ id: 'expired2', expiresAtMs: Date.now() - 2000 }));
      
      store.cleanup();
      
      expect(store.listPending()).toHaveLength(1);
      expect(store.get('valid')).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('clears all data', () => {
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

  it('getActionStore returns singleton', () => {
    const store1 = getActionStore();
    const store2 = getActionStore();
    expect(store1).toBe(store2);
  });

  it('destroyActionStore destroys singleton', () => {
    const store1 = getActionStore();
    store1.store(createMockAction({ id: 'test' }));
    
    destroyActionStore();
    
    const store2 = getActionStore();
    expect(store2).not.toBe(store1);
    expect(store2.listPending()).toHaveLength(0);
  });
});
