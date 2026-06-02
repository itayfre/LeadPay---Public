import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { statementsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ConfirmDialog from '../modals/ConfirmDialog';
import type { RecentUpload } from '../../types';

interface Props {
  buildingId: string;
  onEdit: (statementId: string) => void;
}

const INITIAL_LIMIT = 5;

export default function RecentUploadsList({ buildingId, onEdit }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecentUpload | null>(null);

  const canDelete = user?.role === 'manager';

  const { data, isLoading } = useQuery({
    queryKey: ['statements', buildingId],
    queryFn: () => statementsAPI.listForBuilding(buildingId),
  });

  const deleteMutation = useMutation({
    mutationFn: (statementId: string) => statementsAPI.delete(statementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statements', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
      setPendingDelete(null);
    },
  });

  if (isLoading) {
    return <div className="text-center text-ink-500 py-6">...</div>;
  }

  const all = data?.statements ?? [];
  if (all.length === 0) {
    return (
      <div className="bg-white border border-ink-200 rounded-lg p-6 text-center text-ink-500">
        {t('upload.recentUploads.empty')}
      </div>
    );
  }

  const shown = expanded ? all : all.slice(0, INITIAL_LIMIT);
  const remaining = all.length - shown.length;

  return (
    <div className="bg-white border border-ink-200 rounded-lg overflow-hidden">
      <h3 className="font-bold text-ink-900 px-6 py-4 border-b border-ink-200">
        {t('upload.recentUploads.title')}
      </h3>
      <ul className="divide-y divide-ink-100">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-6 py-3 hover:bg-ink-50">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-medium px-2 py-1 bg-primary-50 text-primary-700 rounded">
                {s.period}
              </span>
              <span className="text-sm text-ink-500">
                {new Date(s.upload_date).toLocaleDateString('he-IL')}
              </span>
              <span className="text-sm text-ink-500 truncate">{s.filename}</span>
              <span className="text-xs text-ink-500">
                {t('upload.recentUploads.transactions', { count: s.transaction_count })}
              </span>
              {s.unmatched_count > 0 ? (
                <button
                  onClick={() => onEdit(s.id)}
                  className="text-xs px-2 py-0.5 rounded-full bg-warn-50 text-warn-600 hover:bg-warn-50"
                >
                  ⚠ {t('upload.recentUploads.unmatched', { count: s.unmatched_count })}
                </button>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent-100 text-accent-700">
                  ✓ {t('upload.recentUploads.matched', { count: s.matched_count })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onEdit(s.id)}
                className="p-2 rounded hover:bg-ink-100 text-ink-700"
                title={t('common.edit')}
              >
                ✏️
              </button>
              {canDelete && (
                <button
                  onClick={() => setPendingDelete(s)}
                  className="p-2 rounded hover:bg-danger-50 text-danger-600"
                  title={t('common.delete')}
                >
                  🗑️
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-3 text-sm text-primary-600 hover:bg-primary-50 border-t border-ink-100"
        >
          {t('upload.recentUploads.showMore', { count: remaining })}
        </button>
      )}
      <ConfirmDialog
        isOpen={!!pendingDelete}
        title={
          pendingDelete
            ? t('upload.delete.confirmTitle', { filename: pendingDelete.filename })
            : ''
        }
        message={
          pendingDelete
            ? t('upload.delete.confirmBody', { count: pendingDelete.transaction_count })
            : ''
        }
        confirmText={t('common.delete')}
        type="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </div>
  );
}
