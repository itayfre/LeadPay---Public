import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import Layout from '../components/layout/Layout';
import { statementsAPI } from '../services/api';
import UploadReviewModal from '../components/modals/UploadReviewModal';
import RecentUploadsList from '../components/upload/RecentUploadsList';
import type { UploadResult } from '../types';

export default function UploadStatement() {
  const { t } = useTranslation();
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reopenStatementId, setReopenStatementId] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  }, []);

  const handleFile = async (file: File) => {
    if (!buildingId) return;

    // Check file type
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf',
    ];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx?|pdf)$/i)) {
      setError('קובץ לא נתמך. אנא העלה קובץ Excel או PDF');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const result = await statementsAPI.upload(buildingId, file);
      // Invalidate payment status query to refresh the dashboard
      queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
      // Open the review modal with full upload result
      setUploadResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!buildingId) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-danger-600">{t('common.error')}: Missing building ID</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <button
            onClick={() => navigate(`/building/${buildingId}`)}
            className="text-primary-600 hover:text-primary-800 mb-2 inline-flex items-center gap-1 text-sm font-medium"
          >
            <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            חזור לדשבורד
          </button>
          <h2 className="text-2xl font-bold text-ink-900">{t('dashboard.uploadStatement')}</h2>
          <p className="text-sm text-ink-500 mt-1">
            העלה דף חשבון בנק מהבנק שלך (Excel או PDF)
          </p>
        </div>

        {/* Upload Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            dragActive
              ? 'border-primary-500 bg-primary-50'
              : 'border-ink-300 bg-white hover:border-ink-500'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".xlsx,.xls,.pdf"
            onChange={handleChange}
            disabled={uploading}
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center"
          >
            <svg className={`w-12 h-12 mb-4 ${dragActive ? 'text-primary-500' : 'text-ink-400'} ${uploading ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-medium text-ink-700 mb-2">
              {uploading
                ? t('upload.uploading')
                : dragActive
                ? 'שחרר כדי להעלות'
                : t('upload.dragDrop')}
            </p>
            <p className="text-sm text-ink-500">
              תומך בקבצי Excel (.xlsx, .xls) ו-PDF
            </p>
          </label>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-danger-50 ring-1 ring-danger-200 rounded-lg p-4">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-danger-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium text-danger-600">{t('upload.error')}</p>
                <p className="text-sm text-danger-600">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Recent uploads list */}
        <RecentUploadsList
          buildingId={buildingId}
          onEdit={(statementId) => setReopenStatementId(statementId)}
        />

        {/* Instructions */}
        {!uploadResult && !error && (
          <div className="bg-primary-50 ring-1 ring-primary-200 rounded-lg p-6">
            <h3 className="font-semibold text-primary-900 text-[15px] mb-4">הוראות שימוש</h3>
            <ol className="space-y-2.5 text-sm text-primary-800">
              {[
                'הורד את דף החשבון מהאתר של הבנק שלך (Excel או PDF)',
                'גרור את הקובץ לאזור ההעלאה או לחץ לבחירת קובץ',
                'המערכת תנתח אוטומטית את העסקאות ותתאים לדיירים',
                'עסקאות שלא הותאמו אוטומטית תוכל להתאים באופן ידני',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Review Modal — opens automatically after successful upload */}
      {uploadResult && buildingId && (
        <UploadReviewModal
          statementId={uploadResult.statement_id}
          buildingId={buildingId}
          uploadResult={uploadResult}
          onClose={() => setUploadResult(null)}
        />
      )}

      {/* Review Modal — re-opened from RecentUploadsList */}
      {reopenStatementId && (
        <UploadReviewModal
          statementId={reopenStatementId}
          buildingId={buildingId}
          onClose={() => setReopenStatementId(null)}
        />
      )}
    </Layout>
  );
}
