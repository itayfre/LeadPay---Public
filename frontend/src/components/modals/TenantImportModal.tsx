import { useState, useCallback } from 'react';
import Modal from '../ui/Modal';
import { useQuery } from '@tanstack/react-query';
import { tenantsAPI, buildingsAPI } from '../../services/api';

interface TenantImportModalProps {
  buildingId: string | null;  // null = global mode, must pick building
  onClose: () => void;
  onImported: () => void;
}

interface ImportResult {
  imported_count: number;
  errors: string[] | null;
}

export default function TenantImportModal({ buildingId, onClose, onImported }: TenantImportModalProps) {
  const isGlobalMode = !buildingId;
  const [selectedBuildingId, setSelectedBuildingId] = useState(buildingId || '');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: buildings } = useQuery({
    queryKey: ['buildings'],
    queryFn: () => buildingsAPI.list(),
    enabled: isGlobalMode,
  });

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('נא לבחור קובץ Excel בלבד (.xlsx או .xls)');
      return;
    }

    const effectiveBuildingId = buildingId || selectedBuildingId;
    if (!effectiveBuildingId) {
      setError('נא לבחור בניין לפני ייבוא הקובץ');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const response = await tenantsAPI.import(effectiveBuildingId, file);
      setResult(response);
      if (response.imported_count > 0) {
        onImported();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }, [buildingId, selectedBuildingId, onImported]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <Modal open onClose={onClose} srTitle="ייבוא דיירים מ-Excel" size="lg" hideClose>
        <div className="bg-gradient-to-l from-primary-600 to-primary-800 p-6 text-white flex justify-between items-center rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold">ייבוא דיירים מ-Excel</h2>
            <p className="text-primary-100 text-sm mt-1">העלה קובץ עם רשימת הדיירים</p>
          </div>
          <button onClick={onClose} aria-label="סגור חלון" className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4" dir="rtl">
          {/* Building picker — global mode only */}
          {isGlobalMode && !result && (
            <div>
              <label htmlFor="tim-building" className="block text-sm font-medium text-ink-700 mb-1">בניין *</label>
              <select
                id="tim-building"
                value={selectedBuildingId}
                onChange={e => setSelectedBuildingId(e.target.value)}
                className="w-full border border-ink-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500"
              >
                <option value="">— בחר בניין —</option>
                {buildings?.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <p className="text-xs text-ink-500 mt-1">כל הדיירים בקובץ ישויכו לבניין זה</p>
            </div>
          )}

          {/* Drop zone */}
          {!result && (
            <label
              className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragActive ? 'border-primary-500 bg-primary-50' : 'border-ink-300 hover:border-primary-400 hover:bg-primary-50'
              }`}
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept=".xlsx,.xls" onChange={handleChange} disabled={uploading} className="hidden" />
              <div className="text-4xl mb-3">📊</div>
              {uploading ? (
                <p className="text-primary-600 font-medium">מעלה...</p>
              ) : (
                <>
                  <p className="font-medium text-ink-700 mb-1">גרור קובץ לכאן או לחץ לבחירה</p>
                  <p className="text-sm text-ink-500">.xlsx או .xls</p>
                </>
              )}
            </label>
          )}

          {error && (
            <div className="bg-danger-50 border border-danger-50 rounded-lg p-4">
              <p className="font-medium text-danger-600 mb-1">שגיאה</p>
              <p className="text-sm text-danger-600">{error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="bg-accent-50 border border-accent-200 rounded-lg p-4">
                <p className="font-bold text-accent-700 text-lg">
                  ✅ יובאו {result.imported_count} דיירים בהצלחה
                  {result.errors && result.errors.length > 0 && `, ${result.errors.length} שגיאות`}
                </p>
              </div>
              {result.errors && result.errors.length > 0 && (
                <div className="bg-warn-50 border border-warn-50 rounded-lg p-4">
                  <p className="font-medium text-warn-600 mb-2">⚠️ שורות עם שגיאות (לא יובאו):</p>
                  <ul className="space-y-1">
                    {result.errors.map((err, i) => (
                      <li key={i} className="text-sm text-warn-600">• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="bg-ink-50 rounded-lg p-4 text-sm">
            <p className="font-semibold text-ink-700 mb-2">📋 פורמט הקובץ (דוח דיירים):</p>
            <div className="grid grid-cols-2 gap-1 text-ink-700">
              <span>• <strong>דירה</strong> — מספר דירה *</span>
              <span>• <strong>קומה</strong> — קומה</span>
              <span>• <strong>שם</strong> — שם דייר *</span>
              <span>• <strong>סוג בעלות</strong> — בעלים/משכיר/שוכר *</span>
              <span>• <strong>טלפון</strong> — אופציונלי</span>
              <span>• <strong>דואל</strong> — אופציונלי</span>
            </div>
          </div>
        </div>

        <div className="border-t border-ink-200 p-4 flex justify-end gap-3 bg-ink-50 rounded-b-xl">
          <button onClick={onClose}
            className="px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-100 font-medium text-sm">
            {result ? 'סגור' : 'ביטול'}
          </button>
          {result && (
            <button onClick={() => { setResult(null); setError(null); setSelectedBuildingId(buildingId || ''); }}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm">
              ייבא קובץ נוסף
            </button>
          )}
        </div>
    </Modal>
  );
}
