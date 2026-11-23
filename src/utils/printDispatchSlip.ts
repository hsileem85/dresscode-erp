import type { CurrencyCode } from '../types/erp';
import { formatMoney } from './calculations';

export interface DispatchMaterialLine {
  id: string;
  kind: 'قماش' | 'كلفة / إكسسوار' | 'خامة إضافية';
  name: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface DispatchVariantLine {
  color: string;
  size: string;
  variantSku: string;
  qty: number;
}

export interface DispatchSlipData {
  voucherNumber: string;
  dispatchDate: string;
  expectedReturnDate?: string;
  batchNumber: string;
  modelName: string;
  modelSku: string;
  workshopName: string;
  workshopPhone?: string;
  workshopContact?: string;
  deliveredBy?: string;
  totalPieces: number;
  variants: DispatchVariantLine[];
  materials: DispatchMaterialLine[];
  showFinancials: boolean;
  agreedLaborTotal: number;
  paidToWorkshop: number;
  remainingWorkshop: number;
  currency: CurrencyCode;
  instructions?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDispatchSlipHtml(data: DispatchSlipData): string {
  const variantsRows = data.variants
    .map(
      (v, idx) => `
      <tr>
        <td class="center">${idx + 1}</td>
        <td><strong>${escapeHtml(v.color)}</strong></td>
        <td class="center"><strong>${escapeHtml(v.size)}</strong></td>
        <td class="mono">${escapeHtml(v.variantSku)}</td>
        <td class="center bold">${v.qty} قطعة</td>
      </tr>`
    )
    .join('');

  const materialRows =
    data.materials.length > 0
      ? data.materials
          .map(
            (m, idx) => `
          <tr>
            <td class="center">${idx + 1}</td>
            <td><span class="badge ${m.kind === 'قماش' ? 'badge-fabric' : 'badge-trim'}">${escapeHtml(m.kind)}</span></td>
            <td><strong>${escapeHtml(m.name)}</strong></td>
            <td class="center bold">${Number(m.quantity.toFixed(2))}</td>
            <td class="center">${escapeHtml(m.unit)}</td>
            <td>${escapeHtml(m.notes || '—')}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="6" class="center muted">لم يتم إدراج خامات تفصيلية</td></tr>`;

  const financialsSection = data.showFinancials
    ? `
    <div class="section">
      <div class="section-title">٣. ملخص الاتفاق المالي مع الورشة</div>
      <div class="fin-grid">
        <div class="fin-box">
          <div class="fin-lbl">إجمالي أجر التقفيل المتفق عليه</div>
          <div class="fin-val">${escapeHtml(formatMoney(data.agreedLaborTotal, data.currency))}</div>
        </div>
        <div class="fin-box">
          <div class="fin-lbl">المدفوع تحت الحساب</div>
          <div class="fin-val green">${escapeHtml(formatMoney(data.paidToWorkshop, data.currency))}</div>
        </div>
        <div class="fin-box highlight">
          <div class="fin-lbl">المتبقي المستحق عند الاستلام</div>
          <div class="fin-val bronze">${escapeHtml(formatMoney(data.remainingWorkshop, data.currency))}</div>
        </div>
      </div>
    </div>`
    : '';

  const instructionsSection = data.instructions?.trim()
    ? `
    <div class="notes-box">
      <strong>ملاحظات وتعليمات التشغيل والتشطيب:</strong>
      <div>${escapeHtml(data.instructions.trim()).replace(/\n/g, '<br/>')}</div>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>إذن تسليم خامات للتصنيع — ${escapeHtml(data.voucherNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      color: #1A1A1E;
      background: #F7F6F3;
      direction: rtl;
      font-size: 12px;
      line-height: 1.6;
    }
    .toolbar {
      max-width: 210mm;
      margin: 12px auto 0;
      padding: 10px 16px;
      background: #1A1A1E;
      color: #fff;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .toolbar button {
      background: #A67C52;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 18px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .toolbar button.secondary {
      background: rgba(255,255,255,0.12);
    }
    .page {
      max-width: 210mm;
      margin: 12px auto 24px;
      background: #FFFFFF;
      border: 1px solid #E5E3DD;
      border-radius: 14px;
      padding: 20px 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.05);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 14px;
      border-bottom: 3px solid #A67C52;
      margin-bottom: 14px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, #BD956D, #8E6742);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 20px;
      letter-spacing: 1px;
    }
    .brand-name {
      font-size: 19px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #1A1A1E;
      line-height: 1.1;
    }
    .brand-sub {
      font-size: 10.5px;
      color: #6E6C66;
    }
    .doc-title-box {
      text-align: center;
    }
    .doc-title {
      font-size: 17px;
      font-weight: 800;
      color: #1A1A1E;
    }
    .doc-sub {
      font-size: 10.5px;
      color: #8E6742;
      font-weight: 700;
    }
    .voucher-meta {
      background: #FAF9F7;
      border: 1px solid #E5E3DD;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 11px;
      min-width: 170px;
    }
    .voucher-meta div { display: flex; justify-content: space-between; gap: 8px; }
    .voucher-meta strong { color: #1A1A1E; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }
    .info-card {
      background: #FAF9F7;
      border: 1px solid #E5E3DD;
      border-radius: 10px;
      padding: 10px 14px;
    }
    .info-card h4 {
      font-size: 11px;
      color: #8E6742;
      font-weight: 800;
      margin-bottom: 5px;
      border-bottom: 1px solid #EAE8E2;
      padding-bottom: 3px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      font-size: 11.2px;
      margin-bottom: 2px;
    }
    .info-row span.k { color: #6E6C66; }
    .section { margin-bottom: 14px; }
    .section-title {
      font-size: 12.5px;
      font-weight: 800;
      color: #1A1A1E;
      margin-bottom: 6px;
      padding-right: 8px;
      border-right: 3.5px solid #A67C52;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.2px;
    }
    th {
      background: #1A1A1E;
      color: #FFFFFF;
      padding: 7px 10px;
      font-weight: 700;
      text-align: right;
      border: 1px solid #1A1A1E;
    }
    td {
      padding: 6.5px 10px;
      border: 1px solid #E5E3DD;
    }
    tbody tr:nth-child(even) { background: #FAF9F7; }
    tfoot td {
      background: #F6EFE7;
      font-weight: 800;
      border: 1px solid #D4B896;
    }
    .center { text-align: center; }
    .bold { font-weight: 800; }
    .mono { font-family: monospace; font-size: 10.8px; direction: ltr; text-align: center; }
    .muted { color: #6E6C66; }
    .badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
    }
    .badge-fabric { background: #1A1A1E; color: #BD956D; }
    .badge-trim { background: #F6EFE7; color: #7B5836; border: 1px solid #E6D5C3; }
    .fin-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .fin-box {
      background: #FAF9F7;
      border: 1px solid #E5E3DD;
      border-radius: 10px;
      padding: 8px 12px;
      text-align: center;
    }
    .fin-box.highlight {
      background: #FBF8F4;
      border-color: #D4B896;
    }
    .fin-lbl { font-size: 10.2px; color: #6E6C66; }
    .fin-val { font-size: 14px; font-weight: 800; color: #1A1A1E; margin-top: 2px; }
    .fin-val.green { color: #047857; }
    .fin-val.bronze { color: #8E6742; }
    .notes-box {
      background: #FBF8F4;
      border: 1px solid #E6D5C3;
      border-radius: 10px;
      padding: 9px 13px;
      margin-bottom: 14px;
      font-size: 11px;
    }
    .declaration {
      font-size: 10.5px;
      color: #4B4A46;
      background: #FAF9F7;
      border: 1px dashed #D1CEC6;
      border-radius: 8px;
      padding: 7px 12px;
      margin-bottom: 16px;
      text-align: center;
    }
    .sign-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-top: 8px;
    }
    .sign-box {
      border: 1px solid #E5E3DD;
      border-radius: 10px;
      padding: 10px 12px;
      min-height: 82px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .sign-title { font-size: 11px; font-weight: 800; color: #1A1A1E; text-align: center; }
    .sign-line {
      border-top: 1px dashed #9C9990;
      padding-top: 4px;
      font-size: 9.8px;
      color: #6E6C66;
      text-align: center;
    }
    .footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid #E5E3DD;
      display: flex;
      justify-content: space-between;
      font-size: 9.8px;
      color: #6E6C66;
    }
    @media print {
      body { background: #FFFFFF; }
      .toolbar { display: none !important; }
      .page {
        margin: 0;
        border: none;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>إذن تسليم خامات للتصنيع — ${escapeHtml(data.voucherNumber)}</span>
    <div style="display:flex;gap:8px;">
      <button type="button" onclick="window.print()">طباعة / حفظ كـ PDF</button>
      <button type="button" class="secondary" onclick="window.close()">إغلاق</button>
    </div>
  </div>

  <div class="page">
    <div class="header">
      <div class="brand">
        <div class="logo">DC</div>
        <div>
          <div class="brand-name">DRESSCODE</div>
          <div class="brand-sub">dresscode-clothing.com</div>
        </div>
      </div>

      <div class="doc-title-box">
        <div class="doc-title">إذن تسليم خامات للتصنيع الخارجي</div>
        <div class="doc-sub">قماش مقصوص • كلف وإكسسوارات • أمر تقفيل</div>
      </div>

      <div class="voucher-meta">
        <div><span>رقم الإذن:</span><strong class="mono">${escapeHtml(data.voucherNumber)}</strong></div>
        <div><span>تاريخ التسليم:</span><strong>${escapeHtml(data.dispatchDate)}</strong></div>
        ${data.expectedReturnDate ? `<div><span>تاريخ الاستلام:</span><strong>${escapeHtml(data.expectedReturnDate)}</strong></div>` : ''}
      </div>
    </div>

    <div class="info-grid">
      <div class="info-card">
        <h4>بيانات الورشة المستلمة</h4>
        <div class="info-row"><span class="k">اسم الورشة:</span><strong>${escapeHtml(data.workshopName)}</strong></div>
        ${data.workshopContact ? `<div class="info-row"><span class="k">المسؤول:</span><span>${escapeHtml(data.workshopContact)}</span></div>` : ''}
        ${data.workshopPhone ? `<div class="info-row"><span class="k">رقم الهاتف:</span><span dir="ltr">${escapeHtml(data.workshopPhone)}</span></div>` : ''}
        ${data.deliveredBy ? `<div class="info-row"><span class="k">المُسلِّم من DressCode:</span><span>${escapeHtml(data.deliveredBy)}</span></div>` : ''}
      </div>

      <div class="info-card">
        <h4>بيانات أمر التصنيع والموديل</h4>
        <div class="info-row"><span class="k">رقم التشغيلة:</span><strong class="mono">${escapeHtml(data.batchNumber)}</strong></div>
        <div class="info-row"><span class="k">اسم الموديل:</span><strong>${escapeHtml(data.modelName)}</strong></div>
        <div class="info-row"><span class="k">كود الموديل (SKU):</span><span class="mono">${escapeHtml(data.modelSku)}</span></div>
        <div class="info-row"><span class="k">إجمالي القطع المطلوبة:</span><strong>${data.totalPieces} قطعة</strong></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">١. بيان القطع المقصوصة المطلوب تقفيلها (حسب اللون والمقاس)</div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:36px;">م</th>
            <th>اللون</th>
            <th class="center">المقاس</th>
            <th class="center">كود الصنف (SKU)</th>
            <th class="center">الكمية</th>
          </tr>
        </thead>
        <tbody>${variantsRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4">إجمالي عدد القطع المقصوصة المسلّمة للورشة</td>
            <td class="center">${data.totalPieces} قطعة</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="section">
      <div class="section-title">٢. بيان الأقمشة والكلف والإكسسوارات المسلّمة للورشة</div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:36px;">م</th>
            <th style="width:110px;">التصنيف</th>
            <th>الصنف / الخامة</th>
            <th class="center" style="width:85px;">الكمية</th>
            <th class="center" style="width:85px;">الوحدة</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>${materialRows}</tbody>
      </table>
    </div>

    ${financialsSection}
    ${instructionsSection}

    <div class="declaration">
      أقرّ أنا الموقّع أدناه باستلام كافة القطع المقصوصة والأقمشة والكلف والإكسسوارات المذكورة في هذا الإذن كاملةً وبحالة سليمة لتنفيذ أعمال التقفيل والتشطيب وفقاً للعينة المعتمدة من DressCode.
    </div>

    <div class="sign-grid">
      <div class="sign-box">
        <div class="sign-title">المُسلِّم (إدارة DressCode)</div>
        <div class="sign-line">الاسم والتوقيع</div>
      </div>
      <div class="sign-box">
        <div class="sign-title">المستلِم (مندوب / صاحب الورشة)</div>
        <div class="sign-line">الاسم والتوقيع</div>
      </div>
      <div class="sign-box">
        <div class="sign-title">اعتماد الاستلام النهائي للمنتج التام</div>
        <div class="sign-line">العدد المستلم / التاريخ / التوقيع</div>
      </div>
    </div>

    <div class="footer">
      <span>DressCode ERP — إذن تسليم خامات رسمي</span>
      <span>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</span>
    </div>
  </div>
</body>
</html>`;
}

export function openAndPrintDispatchSlip(data: DispatchSlipData): void {
  const html = buildDispatchSlipHtml(data);

  // Try standalone printable tab first (cleanest on iOS/Android & desktop)
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch {
        // User can tap the Print button in toolbar
      }
    }, 500);
    return;
  }

  // Fallback to hidden iframe if browser blocked pop-up
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 500);
  }
}
