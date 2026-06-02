import { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { useQuery } from '@tanstack/react-query';
import { tenantsAPI, buildingsAPI } from '../../services/api';
import type { Tenant } from '../../types';

interface TenantModalProps {
  buildingId: string | null;  // null = global mode, must pick building
  tenant?: Tenant | null;
  onClose: () => void;
  onSaved: () => void;
}

const OWNERSHIP_TYPES = ['בעלים', 'משכיר', 'שוכר'] as const;

export default function TenantModal({ buildingId, tenant, onClose, onSaved }: TenantModalProps) {
  const isEdit = !!tenant;
  const isGlobalMode = !buildingId;

  const { data: buildings } = useQuery({
    queryKey: ['buildings'],
    queryFn: () => buildingsAPI.list(),
    enabled: isGlobalMode && !isEdit,
  });

  // Sibling tenants in the same apartment — used to enforce the "exactly one
  // active payer per apartment" invariant when editing.
  const editBuildingId = tenant?.building_id || buildingId || '';
  const { data: aptSiblingsAll } = useQuery({
    queryKey: ['tenants', editBuildingId],
    queryFn: () => tenantsAPI.list(editBuildingId),
    enabled: isEdit && !!editBuildingId && !!tenant?.apartment_id,
  });
  const aptTenants = (aptSiblingsAll || []).filter(
    t => t.apartment_id === tenant?.apartment_id
  );
  const siblings = aptTenants.filter(t => t.id !== tenant?.id);
  const currentActive = aptTenants.find(t => t.is_active);
  const wasActive = tenant?.is_active === true;

  const [form, setForm] = useState({
    selected_building_id: buildingId || '',
    apartment_number: '',
    name: '',
    full_name: '',
    ownership_type: '',
    phone: '',
    email: '',
    language: 'he',
    standing_order_start_date: '',
    standing_order_end_date: '',
    standing_order_amount: '',
    is_active: true,
    move_in_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');

  // "Deactivating the active payer" — needs a replacement from siblings.
  const needsReplacement = isEdit && wasActive && !form.is_active;
  // "Activating a non-primary while another is primary" — auto-switch.
  const willReplaceCurrent =
    isEdit &&
    !wasActive &&
    form.is_active &&
    !!currentActive &&
    currentActive.id !== tenant?.id;

  useEffect(() => {
    if (tenant) {
      setForm({
        selected_building_id: tenant.building_id || buildingId || '',
        apartment_number: String(tenant.apartment_number || ''),
        name: tenant.name || '',
        full_name: tenant.full_name || '',
        ownership_type: tenant.ownership_type || '',
        phone: tenant.phone || '',
        email: tenant.email || '',
        language: tenant.language || 'he',
        standing_order_start_date: tenant.standing_order_start_date || '',
        standing_order_end_date: tenant.standing_order_end_date || '',
        standing_order_amount: tenant.standing_order_amount != null ? String(tenant.standing_order_amount) : '',
        is_active: tenant.is_active !== false,
        move_in_date: tenant.move_in_date || '',
      });
    }
  }, [tenant, buildingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const effectiveBuildingId = buildingId || form.selected_building_id;

    if (!form.apartment_number || !form.name) {
      setError('נא למלא את כל השדות הנדרשים');
      return;
    }
    if (!effectiveBuildingId) {
      setError('נא לבחור בניין');
      return;
    }

    if (needsReplacement && siblings.length === 0) {
      setError('לא ניתן להשבית את המשלם היחיד בדירה. דירה חייבת לכלול משלם פעיל אחד.');
      return;
    }
    if (needsReplacement && !replacementId) {
      setError('יש לבחור דייר אחר שיוגדר כמשלם הראשי.');
      return;
    }

    const soStart = form.standing_order_start_date || null;
    const soEnd = form.standing_order_end_date || null;
    const soAmountNum = form.standing_order_amount.trim() === '' ? null : Number(form.standing_order_amount);
    if (soStart) {
      if (soAmountNum === null || Number.isNaN(soAmountNum) || soAmountNum <= 0) {
        setError('נא להזין סכום הוראת קבע גדול מאפס');
        return;
      }
      if (soEnd && soEnd < soStart) {
        setError('תאריך סיום הוראת הקבע חייב להיות אחרי תאריך ההתחלה');
        return;
      }
    }

    setSaving(true);
    try {
      // Maintain the one-active-payer-per-apartment invariant. Promote the
      // replacement / demote the previous active *before* updating self so
      // we never momentarily have zero active tenants in the apartment.
      if (isEdit && tenant) {
        if (needsReplacement && replacementId) {
          await tenantsAPI.update(replacementId, { is_active: true });
        } else if (willReplaceCurrent && currentActive) {
          await tenantsAPI.update(currentActive.id, { is_active: false });
        }
      }
      if (isEdit && tenant) {
        await tenantsAPI.update(tenant.id, {
          name: form.name,
          full_name: form.full_name || undefined,
          ownership_type: form.ownership_type ? form.ownership_type as Tenant['ownership_type'] : undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          language: form.language as 'he' | 'en',
          standing_order_start_date: soStart,
          standing_order_end_date: soEnd,
          standing_order_amount: soStart ? soAmountNum : null,
          is_active: form.is_active,
          // Empty string → null = clear override, use building default
          move_in_date: form.move_in_date || null,
        });
      } else {
        const { apartment_id } = await tenantsAPI.resolveApartment(
          effectiveBuildingId,
          parseInt(form.apartment_number)
        );
        await tenantsAPI.create({
          apartment_id,
          building_id: effectiveBuildingId,
          name: form.name,
          full_name: form.full_name || undefined,
          ownership_type: form.ownership_type || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          language: form.language,
          standing_order_start_date: soStart,
          standing_order_end_date: soEnd,
          standing_order_amount: soStart ? soAmountNum : null,
          is_active: form.is_active,
          // Omit when blank so backend NULL = building default applies
          move_in_date: form.move_in_date || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full border border-ink-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
  const labelClass = "block text-sm font-medium text-ink-700 mb-1";

  return (
    <Modal open onClose={onClose} srTitle={isEdit ? 'עריכת דייר' : 'הוספת דייר'} size="2xl" hideClose preventClose={saving} className="max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-l from-primary-600 to-primary-800 p-6 text-white flex justify-between items-center">
          <h2 className="text-xl font-bold">{isEdit ? 'עריכת דייר' : 'הוספת דייר'}</h2>
          <button onClick={onClose} aria-label="סגור חלון" className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-6" dir="rtl">
          {error && (
            <div className="mb-4 bg-danger-50 border border-danger-50 rounded-lg p-3 text-danger-600 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Building picker — only in global mode when adding */}
            {isGlobalMode && !isEdit && (
              <div className="col-span-2">
                <label htmlFor="tm-building" className={labelClass}>בניין *</label>
                <select
                  id="tm-building"
                  value={form.selected_building_id}
                  onChange={e => setForm(f => ({ ...f, selected_building_id: e.target.value }))}
                  required
                  className={inputClass}
                >
                  <option value="">— בחר בניין —</option>
                  {buildings?.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="tm-apartment" className={labelClass}>מספר דירה *</label>
              <input
                id="tm-apartment"
                type="number" min="1"
                value={form.apartment_number}
                onChange={e => setForm(f => ({ ...f, apartment_number: e.target.value }))}
                disabled={isEdit} required
                className={inputClass + (isEdit ? ' bg-ink-100 cursor-not-allowed' : '')}
                placeholder="5"
              />
            </div>

            <div>
              <label htmlFor="tm-ownership" className={labelClass}>סוג בעלות</label>
              <select
                id="tm-ownership"
                value={form.ownership_type}
                onChange={e => setForm(f => ({ ...f, ownership_type: e.target.value }))}
                className={inputClass}
              >
                <option value="">— לא מוגדר —</option>
                {OWNERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="tm-name" className={labelClass}>שם תצוגה *</label>
              <input id="tm-name" type="text" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required className={inputClass} placeholder="גיא מ" />
            </div>

            <div>
              <label htmlFor="tm-fullname" className={labelClass}>שם מלא <span className="text-ink-500 font-normal">(לשיוך תשלומים)</span></label>
              <input id="tm-fullname" type="text" value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                className={inputClass} placeholder="גיא מן" />
            </div>

            <div>
              <label htmlFor="tm-phone" className={labelClass}>טלפון</label>
              <input id="tm-phone" type="tel" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className={inputClass} placeholder="0501234567" dir="ltr" />
            </div>

            <div>
              <label htmlFor="tm-email" className={labelClass}>אימייל</label>
              <input id="tm-email" type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className={inputClass} placeholder="email@example.com" dir="ltr" />
            </div>

            <div>
              <label htmlFor="tm-movein" className={labelClass}>
                תאריך כניסה
                <span className="text-ink-500 font-normal text-xs mr-1">(ריק = ברירת מחדל של הבניין)</span>
              </label>
              <input id="tm-movein" type="date" value={form.move_in_date}
                onChange={e => setForm(f => ({ ...f, move_in_date: e.target.value }))}
                className={inputClass} dir="ltr" />
            </div>

            <div>
              <span id="tm-language" className={labelClass}>שפה</span>
              <div role="group" aria-labelledby="tm-language" className="flex gap-2">
                {(['he', 'en'] as const).map(lang => (
                  <button key={lang} type="button"
                    onClick={() => setForm(f => ({ ...f, language: lang }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      form.language === lang
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-ink-700 border-ink-300 hover:border-primary-400'
                    }`}
                  >
                    {lang === 'he' ? 'עברית' : 'English'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 justify-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => {
                    setForm(f => ({ ...f, is_active: e.target.checked }));
                    if (e.target.checked) setReplacementId('');
                  }}
                  className="w-4 h-4 text-primary-600 rounded" />
                דייר פעיל
              </label>
            </div>

            {needsReplacement && (
              <div className="col-span-2 rounded-lg border border-warn-200 bg-warn-50 p-4 text-sm">
                {siblings.length === 0 ? (
                  <div className="text-warn-800">
                    לא ניתן להשבית את המשלם היחיד בדירה. כל דירה חייבת לכלול
                    משלם פעיל אחד. הוסף דייר אחר לפני השבתת הדייר הזה.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-warn-800 font-medium">
                      מי יהיה המשלם הראשי החדש של הדירה?
                    </div>
                    <select
                      value={replacementId}
                      onChange={e => setReplacementId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">— בחר דייר —</option>
                      {siblings.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.ownership_type ? ` (${s.ownership_type})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {willReplaceCurrent && currentActive && (
              <div className="col-span-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                הפיכת דייר זה לפעיל תחליף את {currentActive.name} כמשלם הראשי בדירה.
              </div>
            )}

            {/* Standing order — sky-tinted block to match the rest of the standing-order UI */}
            <div className="col-span-2 rounded-lg border border-sky-100 bg-sky-50/60 p-4">
              <div className="text-sm font-semibold text-sky-800 mb-3">הוראת קבע</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="tm-so-start" className={labelClass}>תאריך התחלה</label>
                  <input id="tm-so-start" type="date" value={form.standing_order_start_date}
                    onChange={e => setForm(f => ({ ...f, standing_order_start_date: e.target.value }))}
                    className={inputClass} dir="ltr" />
                </div>
                <div>
                  <label htmlFor="tm-so-end" className={labelClass}>תאריך סיום <span className="text-ink-500 font-normal">(ללא = רציף)</span></label>
                  <input id="tm-so-end" type="date" value={form.standing_order_end_date}
                    onChange={e => setForm(f => ({ ...f, standing_order_end_date: e.target.value }))}
                    className={inputClass} dir="ltr" disabled={!form.standing_order_start_date} />
                </div>
                <div>
                  <label htmlFor="tm-so-amount" className={labelClass}>סכום חודשי <span className="text-ink-500 font-normal">(₪)</span></label>
                  <input id="tm-so-amount" type="number" min="0" step="1" value={form.standing_order_amount}
                    onChange={e => setForm(f => ({ ...f, standing_order_amount: e.target.value }))}
                    className={inputClass} dir="ltr"
                    placeholder="0"
                    required={!!form.standing_order_start_date} />
                </div>
              </div>
            </div>
          </div>
        </form>

        <div className="border-t border-ink-200 p-4 flex justify-end gap-3 bg-ink-50">
          <button type="button" onClick={onClose}
            className="px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50 font-medium text-sm">
            ביטול
          </button>
          <button onClick={handleSubmit} disabled={saving || (needsReplacement && (siblings.length === 0 || !replacementId))}
            className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-colors">
            {saving ? 'שומר...' : isEdit ? 'שמור שינויים' : 'הוסף דייר'}
          </button>
        </div>
    </Modal>
  );
}
