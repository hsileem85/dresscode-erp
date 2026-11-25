import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Layers, Search, X } from 'lucide-react';
import type { ModelStatus, ProductModel } from '../../types/erp';
import { matchesSmartQuery } from '../../utils/search';

const STATUS_BADGE: Record<ModelStatus, { label: string; cls: string }> = {
  active: { label: 'نشط', cls: 'bg-[#1A1A1E] text-white' },
  sampling: { label: 'عينة', cls: 'bg-[#F6EFE7] text-[#8E6742]' },
  archived: { label: 'مؤرشف', cls: 'bg-[#E5E3DD] text-[#6E6C66]' },
};

export interface ModelSmartSelectAllOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface ModelSmartSelectProps {
  models: ProductModel[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  allOption?: ModelSmartSelectAllOption;
  showVariantCount?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

interface OptionItem {
  value: string;
  isAll?: boolean;
  label: string;
  sku?: string;
  category?: string;
  season?: string;
  status?: ModelStatus;
  variantCount?: number;
  sublabel?: string;
}

export const ModelSmartSelect: React.FC<ModelSmartSelectProps> = ({
  models,
  value,
  onChange,
  disabled = false,
  placeholder = 'اختر الموديل...',
  searchPlaceholder = 'ابحث باسم الموديل أو الكود (SKU) أو الفئة...',
  allOption,
  showVariantCount = false,
  size = 'sm',
  className = '',
  ariaLabel = 'اختيار الموديل',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const filteredOptions = useMemo<OptionItem[]>(() => {
    const items: OptionItem[] = [];

    if (
      allOption &&
      matchesSmartQuery(query, [allOption.label, allOption.sublabel, 'كل الموديلات', 'الكل', 'all'])
    ) {
      items.push({
        value: allOption.value,
        isAll: true,
        label: allOption.label,
        sublabel: allOption.sublabel,
      });
    }

    for (const m of models) {
      const variantColors = m.variants.map((v) => `${v.color} ${v.size} ${v.variantSku}`).join(' ');
      if (
        matchesSmartQuery(query, [
          m.name,
          m.sku,
          m.category,
          m.season,
          m.notes,
          variantColors,
        ])
      ) {
        items.push({
          value: m.id,
          label: m.name,
          sku: m.sku,
          category: m.category,
          season: m.season,
          status: m.status,
          variantCount: m.variants.length,
        });
      }
    }

    return items;
  }, [models, allOption, query]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === value) || null,
    [models, value]
  );
  const isAllSelected = Boolean(allOption && value === allOption.value);

  const safeHighlightIdx =
    filteredOptions.length > 0 ? Math.min(highlightIdx, filteredOptions.length - 1) : -1;

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery('');
    setHighlightIdx(0);
  };

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setQuery('');
        setHighlightIdx(0);
      }
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      setHighlightIdx((prev) => (prev + 1) % filteredOptions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      setHighlightIdx((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (safeHighlightIdx >= 0 && filteredOptions[safeHighlightIdx]) {
        handleSelect(filteredOptions[safeHighlightIdx].value);
      }
    }
  };

  const triggerPadding = size === 'md' ? 'px-3.5 py-2.5 text-sm' : 'px-3 py-2 text-xs';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border text-right transition-colors ${triggerPadding} ${
          disabled
            ? 'border-[#E5E3DD] bg-[#F3F2EE] text-[#6E6C66] cursor-not-allowed'
            : open
            ? 'border-[#A67C52] bg-white ring-2 ring-[#A67C52]/15 cursor-pointer'
            : 'border-[#E5E3DD] bg-white hover:border-[#C5BEB2] cursor-pointer'
        }`}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {isAllSelected && allOption ? (
            <>
              <Layers className="w-3.5 h-3.5 text-[#A67C52] shrink-0" />
              <span className="font-bold text-[#1A1A1E] truncate">{allOption.label}</span>
            </>
          ) : selectedModel ? (
            <div className="min-w-0 flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
              <span className="font-bold text-[#1A1A1E] truncate">{selectedModel.name}</span>
              <span className="font-mono text-[10px] font-semibold text-[#8E6742] bg-[#F6EFE7] px-1.5 py-0.5 rounded shrink-0">
                {selectedModel.sku}
              </span>
              {showVariantCount && (
                <span className="text-[10px] text-[#6E6C66] shrink-0">
                  ({selectedModel.variants.length} مقاس)
                </span>
              )}
            </div>
          ) : (
            <span className="text-[#9C9990] truncate">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[#6E6C66] shrink-0 transition-transform ${
            open ? 'rotate-180 text-[#A67C52]' : ''
          }`}
        />
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-50 mt-1.5 w-full min-w-[260px] rounded-2xl border border-[#E5E3DD] bg-white shadow-xl overflow-hidden"
        >
          {/* Sticky Smart Search Box */}
          <div className="p-2 border-b border-[#F0EFEA] bg-[#FAF9F7]">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-[#A67C52] absolute right-2.5 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightIdx(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="w-full rounded-xl border border-[#E5E3DD] bg-white pr-8 pl-7 py-1.5 text-xs text-[#1A1A1E] focus:outline-none focus:border-[#A67C52]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setHighlightIdx(0);
                    inputRef.current?.focus();
                  }}
                  aria-label="مسح البحث"
                  className="absolute left-2 p-0.5 rounded text-[#9C9990] hover:text-[#1A1A1E] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between px-1 pt-1.5 text-[10px] text-[#6E6C66]">
              <span>
                {query.trim()
                  ? `النتائج المطابقة: ${filteredOptions.length}`
                  : `إجمالي الموديلات: ${models.length}`}
              </span>
              <span>↑↓ للتنقل • Enter للاختيار</span>
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-[#F5F4F0]">
            {filteredOptions.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === safeHighlightIdx;
              const statusMeta = opt.status ? STATUS_BADGE[opt.status] : null;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => handleSelect(opt.value)}
                  className={`w-full text-right px-3 py-2.5 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#FBF8F4]'
                      : isHighlighted
                      ? 'bg-[#F5F3EE]'
                      : 'bg-white hover:bg-[#FAF9F7]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {opt.isAll ? (
                      <div className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-[#A67C52] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#1A1A1E] truncate">
                            {opt.label}
                          </div>
                          {opt.sublabel && (
                            <div className="text-[10px] text-[#6E6C66] truncate">
                              {opt.sublabel}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-[#1A1A1E] truncate">
                            {opt.label}
                          </span>
                          {statusMeta && (
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${statusMeta.cls}`}
                            >
                              {statusMeta.label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[#6E6C66] flex-wrap">
                          {opt.sku && <span className="font-mono text-[#8E6742]">{opt.sku}</span>}
                          {opt.category && (
                            <>
                              <span>•</span>
                              <span>{opt.category}</span>
                            </>
                          )}
                          {opt.season && (
                            <>
                              <span>•</span>
                              <span>{opt.season}</span>
                            </>
                          )}
                          {showVariantCount && typeof opt.variantCount === 'number' && (
                            <>
                              <span>•</span>
                              <span className="font-semibold text-[#1A1A1E]">
                                {opt.variantCount} مقاس مسجل
                              </span>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[#A67C52] shrink-0" />}
                </button>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="py-6 px-3 text-center text-xs text-[#6E6C66]">
                لا يوجد موديل مطابق لعبارة البحث «{query}».
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
