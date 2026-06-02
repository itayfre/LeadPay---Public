import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/layout/Layout';
import Button from '../components/ui/Button';
import { buildingsAPI, statementsAPI } from '../services/api';
import UploadReviewModal from '../components/modals/UploadReviewModal';

export default function StatementsUpload() {
  const queryClient = useQueryClient();
  const [selectedBuilding, setSelectedBuilding] = useState<string>('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<any[]>([]);
  const [reviewStatementId, setReviewStatementId] = useState<string | null>(null);

  // Fetch all buildings
  const { data: buildings } = useQuery({
    queryKey: ['buildings'],
    queryFn: buildingsAPI.list,
  });

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    if (!selectedBuilding) {
      alert('אנא בחר בניין לפני העלאת הקובץ');
      return;
    }

    setUploading(true);
    const results = [];
    let firstStatementId: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const result = await statementsAPI.upload(selectedBuilding, file);
        results.push({ file: file.name, success: true, result });
        // Open review modal for the first successfully uploaded file
        if (!firstStatementId && result.statement_id) {
          firstStatementId = result.statement_id;
        }
      } catch (error) {
        results.push({ file: file.name, success: false, error: (error as Error).message });
      }
    }

    setUploadResults(results);
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['paymentStatus', selectedBuilding] });

    if (firstStatementId) {
      setReviewStatementId(firstStatementId);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-ink-900">העלאת דפי חשבון בנק</h1>
          <p className="text-sm text-ink-500 mt-1">העלה דפי חשבון ממספר בניינים בו-זמנית</p>
        </div>

        {/* Building Selector */}
        <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm p-6">
          <label htmlFor="su-building" className="block text-[13px] font-medium text-ink-700 mb-2">
            בחר בניין
          </label>
          <select
            id="su-building"
            value={selectedBuilding}
            onChange={(e) => setSelectedBuilding(e.target.value)}
            className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
          >
            <option value="">-- בחר בניין --</option>
            {buildings?.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name} - {building.address}, {building.city}
              </option>
            ))}
          </select>
        </div>

        {/* Upload Zone */}
        {selectedBuilding && (
          <div
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
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
              multiple
              onChange={handleChange}
              disabled={uploading}
            />
            <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
              <svg className={`w-14 h-14 mb-5 ${dragActive ? 'text-primary-500' : 'text-ink-400'} ${uploading ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-xl font-semibold text-ink-700 mb-3">
                {uploading ? 'מעלה קבצים...' : dragActive ? 'שחרר כדי להעלות' : 'גרור קבצים לכאן'}
              </p>
              <p className="text-sm text-ink-500 mb-4">
                או לחץ לבחירת קבצים מהמחשב
              </p>
              <p className="text-xs text-ink-500">
                תומך בקבצי Excel (.xlsx, .xls) ו-PDF • ניתן להעלות מספר קבצים בו-זמנית
              </p>
            </label>
          </div>
        )}

        {/* Upload Results */}
        {uploadResults.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-ink-900">תוצאות העלאה</h3>
            <div className="space-y-3">
              {uploadResults.map((result, index) => (
                <div
                  key={index}
                  className={`p-6 rounded-xl ring-1 ${
                    result.success
                      ? 'bg-accent-50 ring-accent-200'
                      : 'bg-danger-50 ring-danger-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2.5 mb-2">
                        {result.success ? (
                          <svg className="w-5 h-5 text-accent-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-danger-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        <h4 className="font-semibold text-ink-900">{result.file}</h4>
                      </div>
                      {result.success ? (
                        <div className="grid grid-cols-3 gap-4 mt-4">
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs text-ink-500">סה"כ עסקאות</p>
                            <p className="text-xl font-bold text-ink-900">
                              {result.result.total_transactions || 0}
                            </p>
                          </div>
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs text-ink-500">הותאמו</p>
                            <p className="text-xl font-bold text-accent-600">
                              {result.result.matched_count || 0}
                            </p>
                          </div>
                          <div className="bg-white rounded-lg p-3">
                            <p className="text-xs text-ink-500">לא הותאמו</p>
                            <p className="text-xl font-bold text-warn-600">
                              {result.result.unmatched_count || 0}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-danger-600 mt-2">{result.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" className="w-full" onClick={() => setUploadResults([])}>
              העלה קבצים נוספים
            </Button>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-primary-50 ring-1 ring-primary-200 rounded-xl p-6">
          <h3 className="font-semibold text-primary-900 text-[15px] mb-4">הוראות שימוש</h3>
          <ol className="space-y-3 text-sm text-primary-800">
            {[
              'בחר בניין מהרשימה',
              'גרור את דפי החשבון או לחץ לבחירת קבצים',
              'המערכת תנתח אוטומטית ותתאים תשלומים לדיירים',
              'עבור לדשבורד של הבניין לצפייה בתוצאות',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Review Modal — opens automatically after successful upload */}
      {reviewStatementId && selectedBuilding && (
        <UploadReviewModal
          statementId={reviewStatementId}
          buildingId={selectedBuilding}
          onClose={() => setReviewStatementId(null)}
        />
      )}
    </Layout>
  );
}
