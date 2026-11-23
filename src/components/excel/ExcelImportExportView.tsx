import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  RotateCcw,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import type { ERPState } from '../../types/erp';
import {
  autoMapColumns,
  downloadExcelTemplate,
  exportFullERPToExcel,
  mapRowsToFabrics,
  mapRowsToModels,
  mapRowsToOperations,
  mapRowsToTrims,
  parseExcelFile,
  TARGET_FIELDS,
} from '../../utils/excel';
import type { ImportTargetType, ParsedWorkbook } from '../../utils/excel';

const TARGET_LABELS: Record<ImportTargetType, string> = {
  fabrics: 'الأقمشة (Fabrics)',
  trims: 'الكلف والإكسسوارات (Trims)',
  operations: 'مراحل التشغيل الخارجي (Labor)',
  models: 'الموديلات والتكاليف (Models)',
};

export const ExcelImportExportView: React.FC = () => {
  const {
    state,
    importFabrics,
    importTrims,
    importOperations,
    importModels,
    importFullJSON,
    resetToSeedData,
  } = useERP();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [targetType, setTargetType] = useState<ImportTargetType>('fabrics');
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadFile = async (file: File) => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const wb = await parseExcelFile(file);
      if (wb.sheetNames.length === 0) {
        setErrorMessage('الملف لا يحتوي على أي أوراق عمل صالحة.');
        return;
      }
      const firstSheet = wb.sheetNames[0];
      const headers = wb.sheets[firstSheet]?.headers || [];
      setParsed(wb);
      setSelectedSheet(firstSheet);
      setColumnMap(autoMapColumns(headers, targetType));
    } catch {
      setErrorMessage('تعذر قراءة الملف. تأكد من أنه ملف Excel (.xlsx) أو CSV صالح.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (parsed) {
      const headers = parsed.sheets[sheetName]?.headers || [];
      setColumnMap(autoMapColumns(headers, targetType));
    }
  };

  const handleTargetChange = (nextTarget: ImportTargetType) => {
    setTargetType(nextTarget);
    if (parsed && selectedSheet) {
      const headers = parsed.sheets[selectedSheet]?.headers || [];
      setColumnMap(autoMapColumns(headers, nextTarget));
    }
  };

  const currentSheet = parsed && selectedSheet ? parsed.sheets[selectedSheet] : null;

  const handleCommitImport = () => {
    if (!currentSheet) return;
    setErrorMessage(null);

    const rows = currentSheet.rows;
    let count = 0;

    if (targetType === 'fabrics') {
      const items = mapRowsToFabrics(rows, columnMap);
      count = items.length;
      if (count > 0) importFabrics(items);
    } else if (targetType === 'trims') {
      const items = mapRowsToTrims(rows, columnMap);
      count = items.length;
      if (count > 0) importTrims(items);
    } else if (targetType === 'operations') {
      const items = mapRowsToOperations(rows, columnMap);
      count = items.length;
      if (count > 0) importOperations(items);
    } else if (targetType === 'models') {
      const items = mapRowsToModels(rows, columnMap);
      count = items.length;
      if (count > 0) importModels(items);
    }

    if (count === 0) {
      setErrorMessage(
        'لم يتم العثور على صفوف صالحة للاستيراد. تأكد من ربط العمود الأساسي (الاسم) بشكل صحيح.'
      );
      return;
    }

    setStatusMessage(`تم استيراد ${count} سجل بنجاح إلى قسم ${TARGET_LABELS[targetType]}.`);
    setParsed(null);
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DressCode_ERP_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as ERPState;
      if (!Array.isArray(data.fabrics) || !Array.isArray(data.models)) {
        setErrorMessage('ملف JSON غير متوافق مع هيكل DressCode ERP.');
        return;
      }
      importFullJSON(data);
      setStatusMessage('تم استعادة النسخة الاحتياطية (JSON) بنجاح.');
      setErrorMessage(null);
    } catch {
      setErrorMessage('تعذر قراءة ملف النسخة الاحتياطية JSON.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Banners */}
      {statusMessage && (
        <div className="rounded-xl bg-[#FBF8F4] border border-[#A67C52] px-4 py-3 flex items-center gap-2.5 text-sm font-semibold text-[#7B5836]">
          <CheckCircle2 className="w-5 h-5 text-[#A67C52] shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Top Action Cards: Export & Templates */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-[#F6EFE7] text-[#A67C52] flex items-center justify-center mb-3">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-[#1A1A1E]">
              تصدير تقرير التكاليف الكامل (.xlsx)
            </h3>
            <p className="text-xs text-[#6E6C66] mt-1">
              ملف إكسل متعدد الصفحات يشمل ملخص الموديلات، الأقمشة، الكلف، التشغيل، والمصاريف.
            </p>
          </div>
          <button
            type="button"
            onClick={() => exportFullERPToExcel(state)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1A1A1E] hover:bg-[#2E2E35] text-white text-xs font-semibold py-2.5 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#BD956D]" />
            <span>تحميل ملف الإكسل الكامل</span>
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-[#F3F2EE] text-[#1A1A1E] flex items-center justify-center mb-3">
              <Download className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-[#1A1A1E]">
              تحميل قالب إكسل جاهز للاستيراد
            </h3>
            <p className="text-xs text-[#6E6C66] mt-1">
              نموذج منسّق بالأعمدة العربية الجاهزة لتعبئة الأقمشة والكلف ومراحل التشغيل ورفعها فوراً.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadExcelTemplate}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#F6EFE7] hover:bg-[#EDE0D1] text-[#8E6742] text-xs font-semibold py-2.5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تحميل القالب (.xlsx)</span>
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E3DD] p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="w-10 h-10 rounded-xl bg-[#F3F2EE] text-[#1A1A1E] flex items-center justify-center mb-3">
              <FileJson className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-[#1A1A1E]">
              النسخ الاحتياطي والاستعادة (JSON)
            </h3>
            <p className="text-xs text-[#6E6C66] mt-1">
              احفظ نسخة كاملة من بيانات النظام أو استعدها على أي جهاز آخر بضغطة زر.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJSON}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E5E3DD] hover:bg-[#FAF9F7] text-[#1A1A1E] text-xs font-semibold py-2 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              تصدير
            </button>
            <button
              type="button"
              onClick={() => jsonInputRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E5E3DD] hover:bg-[#FAF9F7] text-[#1A1A1E] text-xs font-semibold py-2 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              استعادة
            </button>
            <button
              type="button"
              onClick={() => {
                void resetToSeedData().then((confirmed) => {
                  if (confirmed) {
                    setStatusMessage('تمت استعادة البيانات الافتراضية لـ DressCode.');
                  }
                });
              }}
              title="استعادة البيانات الافتراضية"
              className="p-2 rounded-xl border border-[#E5E3DD] text-[#6E6C66] hover:text-red-600 hover:border-red-200 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportJSON(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>

      {/* Smart Drag & Drop Excel Importer */}
      <div className="bg-white rounded-2xl border border-[#E5E3DD] p-4 sm:p-6 space-y-5">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-[#1A1A1E]">
            الاستيراد الذكي من شيت الإكسل (.xlsx / .csv)
          </h2>
          <p className="text-xs text-[#6E6C66] mt-0.5">
            اسحب ملف الإكسل الخاص بك هنا لمعاينة الصفوف وربط الأعمدة تلقائياً مع حقول النظام
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-6 sm:p-10 text-center transition-all cursor-pointer ${
            dragging
              ? 'border-[#A67C52] bg-[#FBF8F4]'
              : 'border-[#D1CEC6] bg-[#FAF9F7] hover:border-[#A67C52]'
          }`}
        >
          <UploadCloud className="w-9 h-9 sm:w-10 sm:h-10 text-[#A67C52] mx-auto mb-2.5 sm:mb-3" />
          <p className="text-xs sm:text-sm font-bold text-[#1A1A1E]">
            اسحب وأفلت ملف الإكسل (.xlsx / .csv) هنا، أو اضغط للاختيار من جهازك
          </p>
          <p className="text-[11px] sm:text-xs text-[#6E6C66] mt-1">
            يدعم الأوراق المتعددة والتعرف التلقائي على الأعمدة العربية والإنجليزية
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {/* Column Mapping & Preview Table */}
        {parsed && currentSheet && (
          <div className="space-y-5 pt-2 border-t border-[#F0EFEA]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 bg-[#FAF9F7] p-3.5 sm:p-4 rounded-xl border border-[#E5E3DD]">
              <div>
                <div className="text-[11px] text-[#6E6C66] mb-1">الملف المرفوع</div>
                <div className="text-sm font-bold text-[#1A1A1E] truncate">
                  {parsed.fileName} ({currentSheet.rows.length} صف)
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#6E6C66] mb-1">
                  اختر ورقة العمل (Sheet)
                </label>
                <select
                  value={selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-2 sm:py-1.5 text-xs font-semibold focus:outline-none focus:border-[#A67C52]"
                >
                  {parsed.sheetNames.map((s) => (
                    <option key={s} value={s}>
                      {s} ({parsed.sheets[s].rows.length} صف)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#6E6C66] mb-1">
                  الاستيراد إلى قسم
                </label>
                <select
                  value={targetType}
                  onChange={(e) =>
                    handleTargetChange(e.target.value as ImportTargetType)
                  }
                  className="w-full rounded-lg border border-[#E5E3DD] bg-white px-2.5 py-2 sm:py-1.5 text-xs font-semibold focus:outline-none focus:border-[#A67C52]"
                >
                  {Object.entries(TARGET_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Column Mapper Grid */}
            <div>
              <h3 className="text-xs font-bold text-[#1A1A1E] mb-2.5">
                ربط أعمدة الإكسل بحقول النظام:
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {TARGET_FIELDS[targetType].map((field) => (
                  <div
                    key={field.key}
                    className="rounded-xl border border-[#EAE8E2] p-3 bg-white"
                  >
                    <label className="block text-xs font-semibold text-[#1A1A1E] mb-1">
                      {field.label}{' '}
                      {field.required && <span className="text-[#A67C52]">*</span>}
                    </label>
                    <select
                      value={columnMap[field.key] || ''}
                      onChange={(e) =>
                        setColumnMap((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-[#E5E3DD] bg-[#FAF9F7] px-2.5 py-2 sm:py-1.5 text-xs focus:outline-none focus:border-[#A67C52]"
                    >
                      <option value="">-- تجاهل هذا الحقل --</option>
                      {currentSheet.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Preview Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-[#1A1A1E]">
                  معاينة البيانات (أول {Math.min(8, currentSheet.rows.length)} صفوف)
                </h3>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#E5E3DD]">
                <table className="w-full text-xs text-right">
                  <thead className="bg-[#FAF9F7] text-[#6E6C66] border-b border-[#E5E3DD]">
                    <tr>
                      {currentSheet.headers.map((h) => (
                        <th key={h} className="py-2.5 px-3 font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EFEA]">
                    {currentSheet.rows.slice(0, 8).map((row, idx) => (
                      <tr key={idx}>
                        {currentSheet.headers.map((h) => (
                          <td
                            key={h}
                            className="py-2 px-3 text-[#1A1A1E] whitespace-nowrap max-w-[200px] truncate"
                          >
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setParsed(null)}
                className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl text-xs font-semibold text-[#6E6C66] hover:bg-[#F3F2EE] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                id="btn-confirm-excel-import"
                type="button"
                onClick={handleCommitImport}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#A67C52] hover:bg-[#8E6742] text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  تأكيد واستيراد {currentSheet.rows.length} صف إلى {TARGET_LABELS[targetType]}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
