import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from '../ui/Modal';
import { useTranslation } from 'react-i18next';
import { monthlyAmountsImportAPI } from '../../services/api';
import type {
  ImportApplyResponse,
  ImportPreviewResponse,
  ImportPreviewRow,
  ImportScope,
} from '../../types';

interface Props {
  isOpen: boolean;
  buildingId: string;
  onClose: () => void;
  onApplied?: (result: ImportApplyResponse) => void;
}

/**
 * Upload the "tenants xlsx" to update apartment.expected_payment
 * (and optionally past period_debts). Two-phase: preview first, then apply.
 */
export default function MonthlyImportModal({ isOpen, buildingId, onClose, onApplied }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [scope, setScope] = useState<ImportScope>('future_only');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [appliedResult, setAppliedResult] = useState<ImportApplyResponse | null>(null);

  // ── Mutations ──────────────────────────────────────────────────────────
  const previewMutation = useMutation({
    mutationFn: (f: File) => monthlyAmountsImportAPI.preview(buildingId, f),
    onSuccess: (data) => {
      setPreview(data);
      setErrorMessage(null);
    },
    onError: (err: Error) => setErrorMessage(err.message),
  });

  const applyMutation = useMutation({
    mutationFn: ({ f, s }: { f: File; s: ImportScope }) =>
      monthlyAmountsImportAPI.apply(buildingId, f, s),
    onSuccess: (data) => {
      setAppliedResult(data);
      queryClient.invalidateQueries({ queryKey: ['collecting', buildingId] });
      onApplied?.(data);
    },
    onError: (err: Error) => setErrorMessage(err.message),
  });


  const handleClose = () => {
    setFile(null);
    setPreview(null);
    setScope('future_only');
    setErrorMessage(null);
    setAppliedResult(null);
    onClose();
  };

  const handleFile = (selected: File | null) => {
    setErrorMessage(null);
    setPreview(null);
    setAppliedResult(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!selected.name.toLowerCase().endsWith('.xlsx')) {
      setErrorMessage(t('monthlyImport.wrongFileType'));
      return;
    }
    setFile(selected);
    previewMutation.mutate(selected);
  };

  const canApply = !!file && !!preview && preview.update_count > 0 && !appliedResult;

  return (
    <Modal open={isOpen} onClose={handleClose} srTitle={t('monthlyImport.modalTitle')} size="3xl" hideClose className="max-h-[90vh] flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{t('monthlyImport.modalTitle')}</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="סגור חלון">×</button>
        </header>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* File picker */}
          {!appliedResult && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('monthlyImport.fileLabel')}</label>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
              <p className="mt-1 text-xs text-slate-500">{t('monthlyImport.fileHint')}</p>
            </div>
          )}

          {/* Preview in progress */}
          {previewMutation.isPending && (
            <div className="text-sm text-slate-500 py-4 text-center">{t('monthlyImport.previewing')}</div>
          )}

          {/* Preview results */}
          {preview && !appliedResult && (
            <PreviewSection preview={preview} />
          )}

          {/* Scope picker (only when preview is non-empty) */}
          {preview && preview.update_count > 0 && !appliedResult && (
            <fieldset>
              <legend className="block text-sm font-medium text-slate-700 mb-2">{t('monthlyImport.scopeLabel')}</legend>
              <div className="space-y-2">
                {(['future_only', 'future_plus_current', 'all_unpaid'] as const).map((s) => (
                  <label
                    key={s}
                    className={`flex items-start gap-2 border rounded-md p-2.5 cursor-pointer transition-colors ${
                      scope === s ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} className="mt-1" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">{t(`monthlyImport.scope${pascal(s)}`)}</div>
                      <div className="text-xs text-slate-500">{t(`monthlyImport.scope${pascal(s)}Help`)}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* Applied result */}
          {appliedResult && (
            <div className="bg-accent-50 border border-accent-200 rounded-md px-4 py-3 text-sm text-accent-800">
              {t('monthlyImport.appliedResult', {
                apts: appliedResult.apartments_updated,
                periods: appliedResult.period_debts_updated,
              })}
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-sm text-rose-800" role="alert">
              {errorMessage}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={previewMutation.isPending || applyMutation.isPending}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            {appliedResult ? 'סגור' : t('monthlyImport.cancel')}
          </button>
          {!appliedResult && (
            <button
              type="button"
              onClick={() => file && applyMutation.mutate({ f: file, s: scope })}
              disabled={!canApply || applyMutation.isPending}
              className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applyMutation.isPending ? t('monthlyImport.applying') : t('monthlyImport.applyButton')}
            </button>
          )}
        </footer>
    </Modal>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function PreviewSection({ preview }: { preview: ImportPreviewResponse }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-900">{t('monthlyImport.previewTitle')}</h3>
        <div className="text-xs text-slate-500 flex gap-3">
          <span>{t('monthlyImport.matchedCount', { n: preview.matched_count })}</span>
          {preview.unmatched_count > 0 && (
            <span className="text-warn-600">
              {t('monthlyImport.unmatchedCount', { n: preview.unmatched_count })}
            </span>
          )}
          <span className="font-medium">
            {t('monthlyImport.updateCount', { n: preview.update_count })}
          </span>
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-md">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-700 z-10">
            <tr>
              <th className="px-3 py-2 text-right font-medium">{t('monthlyImport.aptHeader')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('monthlyImport.currentHeader')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('monthlyImport.newHeader')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('monthlyImport.deltaHeader')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('monthlyImport.statusHeader')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.rows.map((row, i) => (
              <PreviewRowEl key={i} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewRowEl({ row }: { row: ImportPreviewRow }) {
  const { t } = useTranslation();
  const statusKey = `monthlyImport.status${pascal(row.status)}`;
  const statusColors: Record<typeof row.status, string> = {
    unchanged: 'text-slate-400',
    update:    'text-primary-600',
    new_value: 'text-accent-600',
    unmatched: 'text-warn-600',
  };
  return (
    <tr className={row.status === 'unmatched' ? 'bg-warn-50' : ''}>
      <td className="px-3 py-1.5 font-medium tabular-nums">{row.apt_label}</td>
      <td className="px-3 py-1.5 text-left tabular-nums text-slate-700">
        {row.current_amount ?? '—'}
      </td>
      <td className="px-3 py-1.5 text-left tabular-nums text-slate-900 font-medium">
        {row.new_amount}
      </td>
      <td className="px-3 py-1.5 text-left tabular-nums text-slate-500">{row.delta}</td>
      <td className={`px-3 py-1.5 text-left ${statusColors[row.status]}`}>
        {t(statusKey)}
      </td>
    </tr>
  );
}

function pascal(s: string): string {
  return s
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}
