import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    if (resolve) resolve(accepted);
  }, []);

  const confirmAction = useCallback<ConfirmFn>((opts) => {
    // If another dialog was somehow open, cancel the previous one safely
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, settle]);

  const isWarning = options?.tone === 'warning';

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}

      {options && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-[#121215]/60 backdrop-blur-[2px] p-0 sm:p-4"
          onClick={() => settle(false)}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
        >
          <div
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-white border border-[#E5E3DD] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile grab handle */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1 bg-[#FAF9F7]">
              <span className="w-10 h-1 rounded-full bg-[#D1CEC6]" />
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isWarning
                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                        : 'bg-red-50 text-red-600 border border-red-200'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      id="confirm-dialog-title"
                      className="text-base font-bold text-[#1A1A1E]"
                    >
                      {options.title}
                    </h3>
                    <p
                      id="confirm-dialog-message"
                      className="text-xs sm:text-sm text-[#4B4A46] mt-1 leading-relaxed"
                    >
                      {options.message}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => settle(false)}
                  aria-label="إغلاق"
                  className="p-1.5 rounded-lg text-[#9C9990] hover:text-[#1A1A1E] hover:bg-[#F3F2EE] cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {options.detail && (
                <div
                  className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed border ${
                    isWarning
                      ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                      : 'bg-red-50/70 border-red-200 text-red-800'
                  }`}
                >
                  {options.detail}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-[#F0EFEA] safe-area-bottom">
                <button
                  type="button"
                  onClick={() => settle(false)}
                  className="px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold border border-[#E5E3DD] text-[#4B4A46] hover:bg-[#FAF9F7] transition-colors cursor-pointer"
                >
                  {options.cancelLabel || 'تراجع'}
                </button>
                <button
                  type="button"
                  onClick={() => settle(true)}
                  className={`px-5 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold text-white transition-colors cursor-pointer ${
                    isWarning
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {options.confirmLabel || 'نعم، تأكيد'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return ctx;
}
