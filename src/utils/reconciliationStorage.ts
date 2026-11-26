import type { ReconciliationSession } from '../types/erp';

export const RECONCILIATION_HISTORY_STORAGE_KEY = 'dresscode_reconciliation_history_v1';

export function loadLocalReconciliationHistory(): ReconciliationSession[] {
  try {
    const raw = localStorage.getItem(RECONCILIATION_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReconciliationSession[]) : [];
  } catch {
    return [];
  }
}

export function appendLocalReconciliationHistory(session: ReconciliationSession): void {
  try {
    const existing = loadLocalReconciliationHistory().filter((s) => s.id !== session.id);
    const next = [session, ...existing].slice(0, 120);
    localStorage.setItem(RECONCILIATION_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}
