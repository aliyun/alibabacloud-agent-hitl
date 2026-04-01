/**
 * Action Store - Simple in-memory storage for pending actions
 * 
 * Stores intercepted exec commands until approved/rejected via /approve-action
 */

import { nanoid } from 'nanoid';
import type { PendingAction } from './types.js';

export type { PendingAction };

export class ActionStore {
  private pending = new Map<string, PendingAction>();

  /**
   * Generate a short unique ID (8 characters)
   */
  generateId(): string {
    return nanoid(8);
  }

  /**
   * Store a pending action
   * Also triggers async cleanup of expired actions
   */
  store(action: PendingAction): void {
    this.pending.set(action.id, action);
    // Async cleanup: run in next tick to avoid blocking
    setImmediate(() => this.cleanup());
  }

  /**
   * Get a pending action by ID (exact match only)
   */
  get(id: string): PendingAction | undefined {
    const action = this.pending.get(id);
    if (!action) {
      return undefined;
    }
    if (action.expiresAtMs <= Date.now()) {
      this.pending.delete(id);
      return undefined;
    }
    return action;
  }

  /**
   * Delete a pending action by ID
   */
  delete(id: string): boolean {
    return this.pending.delete(id);
  }

  /**
   * List all non-expired pending actions
   */
  listPending(): PendingAction[] {
    const now = Date.now();
    const result: PendingAction[] = [];
    for (const [key, action] of this.pending.entries()) {
      if (action.expiresAtMs <= now) {
        this.pending.delete(key);
      } else {
        result.push(action);
      }
    }
    return result.sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  /**
   * List pending actions by session key
   */
  listBySession(sessionKey: string | undefined): PendingAction[] {
    const now = Date.now();
    const result: PendingAction[] = [];
    for (const [key, action] of this.pending.entries()) {
      if (action.expiresAtMs <= now) {
        this.pending.delete(key);
        continue;
      }
      if (action.sessionKey === sessionKey) {
        result.push(action);
      }
    }
    return result.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  /**
   * Get and remove all pending actions by session key
   * Returns actions sorted by creation time (oldest first)
   */
  takeBySession(sessionKey: string | undefined): PendingAction[] {
    const now = Date.now();
    const result: PendingAction[] = [];
    const keysToDelete: string[] = [];

    for (const [key, action] of this.pending.entries()) {
      if (action.expiresAtMs <= now) {
        keysToDelete.push(key);
        continue;
      }
      if (action.sessionKey === sessionKey) {
        result.push(action);
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.pending.delete(key);
    }

    return result.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  /**
   * Delete all pending actions by session key
   * Returns number of deleted actions
   */
  deleteBySession(sessionKey: string | undefined): number {
    const now = Date.now();
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key, action] of this.pending.entries()) {
      if (action.expiresAtMs <= now) {
        keysToDelete.push(key);
        continue;
      }
      if (action.sessionKey === sessionKey) {
        keysToDelete.push(key);
        count++;
      }
    }

    for (const key of keysToDelete) {
      this.pending.delete(key);
    }

    return count;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, action] of this.pending.entries()) {
      if (action.expiresAtMs <= now) {
        this.pending.delete(key);
      }
    }
  }

  /**
   * Destroy the store and clear data
   */
  destroy(): void {
    this.pending.clear();
  }
}

// Global singleton
let globalStore: ActionStore | null = null;

export function getActionStore(): ActionStore {
  if (!globalStore) {
    globalStore = new ActionStore();
  }
  return globalStore;
}

export function destroyActionStore(): void {
  if (globalStore) {
    globalStore.destroy();
    globalStore = null;
  }
}
