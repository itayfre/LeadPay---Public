import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { expensesAPI } from '../../services/api';
import Modal from '../ui/Modal';
import type { ExpenseCategory } from '../../types';

interface Props {
  buildingId: string;
  onClose: () => void;
}

// ─── Default color palette for new categories ─────────────────────────────────

const PALETTE = [
  '#4C72B0', '#DD8452', '#55A868', '#C44E52',
  '#8172B3', '#937860', '#DA8BC3', '#8C8C8C',
  '#CCB974', '#64B5CD',
];

// ─── CategoryRow ──────────────────────────────────────────────────────────────

interface CategoryRowProps {
  cat: ExpenseCategory;
  onRename: (id: string, name: string, color: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function CategoryRow({ cat, onRename, onDelete }: CategoryRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(cat.name);
  const [colorVal, setColorVal] = useState(cat.color);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!nameVal.trim()) return;
    setSaving(true);
    try {
      await onRename(cat.id, nameVal.trim(), colorVal);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await onDelete(cat.id); }
    finally { setDeleting(false); }
  };

  if (editing) {
    return (
      <li className="flex items-center gap-3 py-2.5 px-1">
        {/* Color picker */}
        <div className="relative flex-shrink-0">
          <input
            type="color"
            value={colorVal}
            onChange={(e) => setColorVal(e.target.value)}
            className="w-7 h-7 rounded-full border border-ink-200 cursor-pointer p-0.5"
            title="בחר צבע"
          />
        </div>
        {/* Name input */}
        <input
          type="text"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') { setEditing(false); setNameVal(cat.name); setColorVal(cat.color); }
          }}
          className="flex-1 border border-ink-300 rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500"
          autoFocus
        />
        <button
          onClick={handleSave}
          disabled={saving || !nameVal.trim()}
          aria-label={t('common.save')}
          className="text-accent-600 hover:text-accent-700 font-bold text-sm px-1 disabled:opacity-40"
        >
          {saving ? '…' : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          )}
        </button>
        <button
          onClick={() => { setEditing(false); setNameVal(cat.name); setColorVal(cat.color); }}
          aria-label={t('common.cancel')}
          className="text-ink-500 hover:text-ink-700 text-sm px-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2.5 px-1 hover:bg-ink-50 rounded-lg group">
      <span
        className="w-5 h-5 rounded-full flex-shrink-0 border border-white shadow-sm"
        style={{ backgroundColor: cat.color }}
      />
      <span className="flex-1 text-sm text-ink-900">{cat.name}</span>
      {cat.is_default && (
        <span className="text-[10px] bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded font-medium">
          {t('building.categories.default')}
        </span>
      )}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setEditing(true)}
          className="p-1 text-ink-500 hover:text-primary-600 rounded"
          title={t('common.edit')}
          aria-label={t('common.edit')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1 text-ink-500 hover:text-danger-600 rounded disabled:opacity-40"
          title={t('common.delete')}
          aria-label={t('common.delete')}
        >
          {deleting ? '…' : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          )}
        </button>
      </div>
    </li>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CategoryManagerModal({ buildingId, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[0]);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: categories, isLoading } = useQuery<ExpenseCategory[]>({
    queryKey: ['expenseCategories', buildingId],
    queryFn: () => expensesAPI.listCategories(buildingId),
    enabled: !!buildingId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expenseCategories', buildingId] });

  // ── Create ─────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      expensesAPI.createCategory(buildingId, data),
    onSuccess: () => {
      invalidate();
      setNewName('');
      setNewColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      setAddError(null);
    },
    onError: () => setAddError(t('building.categories.duplicate_name')),
  });

  // ── Update ─────────────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color: string }) =>
      expensesAPI.patchCategory(id, { name, color }),
    onSuccess: () => invalidate(),
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => expensesAPI.deleteCategory(id),
    onSuccess: () => { invalidate(); setDeleteError(null); },
    onError: () => setDeleteError(t('building.categories.delete_blocked')),
  });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), color: newColor });
  };

  const handleRename = async (id: string, name: string, color: string) => {
    await updateMutation.mutateAsync({ id, name, color });
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
  };

  const catList = categories ?? [];

  return (
    <Modal open onClose={onClose} srTitle={t('building.categories.title')} size="md" hideClose className="max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-ink-200 flex justify-between items-center">
          <h3 className="text-xl font-bold text-ink-900">{t('building.categories.title')}</h3>
          <button onClick={onClose} aria-label="סגור חלון" className="p-2 hover:bg-ink-100 rounded-lg text-ink-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 bg-ink-100 rounded-lg" />
              ))}
            </div>
          ) : catList.length === 0 ? (
            <p className="text-sm text-ink-500 text-center py-4">{t('building.categories.empty')}</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {catList.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          )}
          {deleteError && (
            <p className="mt-3 text-xs text-danger-500 bg-danger-50 border border-danger-50 rounded-lg px-3 py-2">
              {deleteError}
            </p>
          )}
        </div>

        {/* Add new category */}
        <div className="p-6 border-t border-ink-200 bg-ink-50">
          <p className="text-sm font-medium text-ink-700 mb-3">{t('building.categories.add_new')}</p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-9 h-9 rounded-lg border border-ink-200 cursor-pointer p-0.5 flex-shrink-0"
              title="בחר צבע"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder={t('building.categories.name_placeholder')}
              className="flex-1 border border-ink-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 text-sm font-medium whitespace-nowrap"
            >
              {createMutation.isPending ? '...' : t('building.categories.add')}
            </button>
          </div>
          {/* Color palette shortcuts */}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                  newColor === c ? 'border-ink-500 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {addError && <p className="mt-2 text-xs text-danger-500">{addError}</p>}
        </div>
    </Modal>
  );
}
