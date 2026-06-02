/**
 * SendRemindersModal — bulk-send reminders flow.
 *
 * Three channels: EMAIL (auto via Resend), SMS (auto via Inforu), WHATSAPP_LINK (manual wa.me).
 * Mirrors the design from tasks/send-reminders-modal-demo.html.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { buildingsAPI, messagesAPI } from '../../services/api';
import Modal from '../ui/Modal';
import type {
  ReminderFilters,
  ReminderChannel,
  ReminderTemplateId,
  ReminderRecipient,
  WhatsAppBatchItem,
  Building,
} from '../../types';

// ─── Templates (frontend preview text — backend generates the real send text) ─

const TEMPLATE_PREVIEWS: Record<ReminderTemplateId, { title: string; preview: string; sample: string }> = {
  standard: {
    title: 'תזכורת תשלום (סטנדרטית)',
    preview: 'שלום [שם], תזכורת לתשלום ₪[סכום]...',
    sample:
      'שלום {שם},\nתזכורת לתשלום ועד הבית.\n\n🏠 דירה: {דירה}\n💰 סכום: ₪{סכום}\n📅 תקופה: {תקופה}\n\nתודה,\nועד הבית — {בניין}',
  },
  late: {
    title: 'תזכורת איחור',
    preview: 'שים לב, התשלום שלך באיחור...',
    sample:
      'שלום {שם},\nשים לב — התשלום עבור {תקופה} עדיין לא התקבל.\n\nאנא הסדר/י בהקדם.',
  },
  custom: {
    title: 'הודעה מותאמת אישית',
    preview: '✎ ערוך הודעה משלך',
    sample: '',
  },
};

const OWNERSHIP_TYPES = ['בעלים', 'שוכר', 'משכיר'] as const;

interface Props {
  buildingId: string;     // current building (preselected)
  periodMonth: number;
  periodYear: number;
  onClose: () => void;
}

type Step = 'filters' | 'sending' | 'done-auto' | 'whatsapp-list';

interface DoneSummary {
  channel: ReminderChannel;
  sent: number;
  failed: number;
  skipped_no_email?: number;
  skipped_no_phone?: number;
  is_stub?: boolean;
}

export default function SendRemindersModal({ buildingId, periodMonth, periodYear, onClose }: Props) {
  // ─── State ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('filters');
  const [selectedBuildings, setSelectedBuildings] = useState<Set<string>>(new Set([buildingId]));
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());
  const [excludedTenants, setExcludedTenants] = useState<Set<string>>(new Set());
  const [ownershipTypes, setOwnershipTypes] = useState<Set<string>>(new Set(OWNERSHIP_TYPES));
  const [includeCommittee, setIncludeCommittee] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'has_debt' | 'all'>('has_debt');
  const [debtPeriod, setDebtPeriod] = useState<'current_month' | 'all_history' | 'range'>('current_month');
  const [debtFrom, setDebtFrom] = useState<string>(`${periodYear}-01`);
  const [debtTo, setDebtTo] = useState<string>(`${periodYear}-${String(periodMonth).padStart(2, '0')}`);
  const [templateId, setTemplateId] = useState<ReminderTemplateId>('standard');
  const [customText, setCustomText] = useState<string>('');
  const [channel, setChannel] = useState<ReminderChannel>('EMAIL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [doneSummary, setDoneSummary] = useState<DoneSummary | null>(null);
  const [whatsappBatch, setWhatsappBatch] = useState<WhatsAppBatchItem[]>([]);
  const [whatsappSent, setWhatsappSent] = useState<Set<string>>(new Set());

  // ─── Data ─────────────────────────────────────────────────────────────
  const buildingsQuery = useQuery({
    queryKey: ['buildings'],
    queryFn: () => buildingsAPI.list(),
  });

  const filters: ReminderFilters = useMemo(() => ({
    building_ids: Array.from(selectedBuildings),
    ownership_types: Array.from(ownershipTypes),
    include_committee: includeCommittee,
    active_only: activeOnly,
    status_filter: statusFilter,
    debt_period: debtPeriod,
    debt_from: debtPeriod === 'range' ? debtFrom : null,
    debt_to: debtPeriod === 'range' ? debtTo : null,
    current_month: periodMonth,
    current_year: periodYear,
    excluded_tenant_ids: Array.from(excludedTenants),
  }), [
    selectedBuildings, ownershipTypes, includeCommittee, activeOnly,
    statusFilter, debtPeriod, debtFrom, debtTo, periodMonth, periodYear, excludedTenants,
  ]);

  // Live preview (re-runs when filters change)
  const previewQuery = useQuery({
    queryKey: ['reminder-preview', filters],
    queryFn: () => messagesAPI.previewReminders(filters),
    enabled: step === 'filters' && selectedBuildings.size > 0,
  });

  const preview = previewQuery.data;
  const recipientsByBuilding = useMemo(() => {
    const m: Record<string, ReminderRecipient[]> = {};
    for (const r of preview?.recipients ?? []) {
      (m[r.building_id] ||= []).push(r);
    }
    return m;
  }, [preview]);

  // ─── Mutations ────────────────────────────────────────────────────────
  const sendEmailMut = useMutation({
    mutationFn: () => messagesAPI.sendEmail(buildSendBody()),
    onSuccess: (res) => {
      setDoneSummary({
        channel: 'EMAIL', sent: res.sent, failed: res.failed,
        skipped_no_email: res.skipped_no_email, is_stub: res.is_stub,
      });
      setStep('done-auto');
    },
  });
  const sendSmsMut = useMutation({
    mutationFn: () => messagesAPI.sendSms(buildSendBody()),
    onSuccess: (res) => {
      setDoneSummary({
        channel: 'SMS', sent: res.sent, failed: res.failed,
        skipped_no_phone: res.skipped_no_phone, is_stub: res.is_stub,
      });
      setStep('done-auto');
    },
  });
  const whatsappBatchMut = useMutation({
    mutationFn: () => messagesAPI.whatsappBatch(buildSendBody()),
    onSuccess: (res) => {
      setWhatsappBatch(res.items);
      setStep('whatsapp-list');
    },
  });

  function buildSendBody() {
    return {
      filters,
      channel,
      template_id: templateId,
      custom_text: templateId === 'custom' ? customText : null,
      period: `${String(periodMonth).padStart(2, '0')}/${periodYear}`,
      period_month: periodMonth,
      period_year: periodYear,
    };
  }

  const handleSubmit = () => {
    if (channel === 'EMAIL') { setStep('sending'); sendEmailMut.mutate(); }
    else if (channel === 'SMS') { setStep('sending'); sendSmsMut.mutate(); }
    else { whatsappBatchMut.mutate(); }
  };

  const handleWhatsAppSend = async (item: WhatsAppBatchItem) => {
    window.open(item.whatsapp_link, '_blank');
    // Mark sent in backend (fire-and-forget; UI updates optimistically)
    try { await messagesAPI.markSent(item.message_id); } catch { /* ignore */ }
    setWhatsappSent((prev) => new Set(prev).add(item.tenant_id));
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <Modal open onClose={onClose} srTitle="שליחת תזכורות לדיירים" size="3xl" hideClose className="max-h-[92vh] flex flex-col">
        {step === 'filters' && (
          <FiltersView
            buildings={buildingsQuery.data ?? []}
            selectedBuildings={selectedBuildings}
            setSelectedBuildings={setSelectedBuildings}
            expandedBuildings={expandedBuildings}
            setExpandedBuildings={setExpandedBuildings}
            excludedTenants={excludedTenants}
            setExcludedTenants={setExcludedTenants}
            recipientsByBuilding={recipientsByBuilding}
            ownershipTypes={ownershipTypes}
            setOwnershipTypes={setOwnershipTypes}
            includeCommittee={includeCommittee}
            setIncludeCommittee={setIncludeCommittee}
            activeOnly={activeOnly}
            setActiveOnly={setActiveOnly}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            debtPeriod={debtPeriod}
            setDebtPeriod={setDebtPeriod}
            debtFrom={debtFrom}
            setDebtFrom={setDebtFrom}
            debtTo={debtTo}
            setDebtTo={setDebtTo}
            templateId={templateId}
            setTemplateId={setTemplateId}
            customText={customText}
            setCustomText={setCustomText}
            channel={channel}
            setChannel={setChannel}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            periodMonth={periodMonth}
            periodYear={periodYear}
            preview={preview}
            isLoading={previewQuery.isLoading || previewQuery.isFetching}
            onClose={onClose}
            onSubmit={handleSubmit}
          />
        )}

        {step === 'sending' && (
          <div className="p-10 text-center">
            <svg className="w-12 h-12 mx-auto mb-4 animate-spin text-accent-700" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <h2 className="text-xl font-bold mb-2">שולח הודעות</h2>
            <p className="text-ink-500 text-sm">בדרך כלל עד 10 שניות</p>
            <div className="mt-6 h-1.5 bg-ink-100 rounded-full overflow-hidden max-w-xs mx-auto">
              <div className="h-full bg-accent-700 animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {step === 'done-auto' && doneSummary && (
          <DoneView summary={doneSummary} onClose={onClose} />
        )}

        {step === 'whatsapp-list' && (
          <WhatsAppManualList
            items={whatsappBatch}
            sentSet={whatsappSent}
            onSend={handleWhatsAppSend}
            onClose={onClose}
          />
        )}
    </Modal>
  );
}

// ─── FiltersView ──────────────────────────────────────────────────────────────

interface FiltersViewProps {
  buildings: Building[];
  selectedBuildings: Set<string>;
  setSelectedBuildings: (s: Set<string>) => void;
  expandedBuildings: Set<string>;
  setExpandedBuildings: (s: Set<string>) => void;
  excludedTenants: Set<string>;
  setExcludedTenants: (s: Set<string>) => void;
  recipientsByBuilding: Record<string, ReminderRecipient[]>;
  ownershipTypes: Set<string>;
  setOwnershipTypes: (s: Set<string>) => void;
  includeCommittee: boolean;
  setIncludeCommittee: (v: boolean) => void;
  activeOnly: boolean;
  setActiveOnly: (v: boolean) => void;
  statusFilter: 'has_debt' | 'all';
  setStatusFilter: (v: 'has_debt' | 'all') => void;
  debtPeriod: 'current_month' | 'all_history' | 'range';
  setDebtPeriod: (v: 'current_month' | 'all_history' | 'range') => void;
  debtFrom: string;
  setDebtFrom: (v: string) => void;
  debtTo: string;
  setDebtTo: (v: string) => void;
  templateId: ReminderTemplateId;
  setTemplateId: (v: ReminderTemplateId) => void;
  customText: string;
  setCustomText: (v: string) => void;
  channel: ReminderChannel;
  setChannel: (v: ReminderChannel) => void;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  periodMonth: number;
  periodYear: number;
  preview: { total: number; with_email: number; with_phone: number; recipients: ReminderRecipient[] } | undefined;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

function FiltersView(p: FiltersViewProps) {
  const total = p.preview?.total ?? 0;
  const withEmail = p.preview?.with_email ?? 0;
  const withPhone = p.preview?.with_phone ?? 0;
  const channelCount = p.channel === 'EMAIL' ? withEmail : withPhone;
  const buttonLabel = p.channel === 'WHATSAPP_LINK' ? 'הצג רשימה' : `שלח ${channelCount} הודעות`;

  const filteredBuildings = p.buildings.filter(
    (b) => !p.searchTerm || b.name.includes(p.searchTerm)
  );

  const periodLabel = `${String(p.periodMonth).padStart(2, '0')}/${p.periodYear}`;

  // Channel-specific note
  let note: { kind: 'warn' | 'info'; text: string } | null = null;
  if (p.channel === 'EMAIL' && total > withEmail) {
    note = { kind: 'warn', text: `ל-${total - withEmail} מתוך ${total} דיירים אין מייל — הם לא יקבלו את ההודעה` };
  } else if (p.channel === 'SMS') {
    const cost = (withPhone * 0.07).toFixed(2);
    note = { kind: 'info', text: `עלות משוערת: ₪${cost} (כ-${withPhone} הודעות × 2 קטעים × ₪0.035)` };
  } else if (p.channel === 'WHATSAPP_LINK') {
    note = { kind: 'info', text: 'תיפתח רשימה עם כפתור שליחה פר דייר — תצטרך לאשר ידנית פתיחת WhatsApp Web' };
  }

  return (
    <>
      <div className="px-6 py-4 border-b flex justify-between items-center">
        <h2 className="text-lg font-bold">שליחת הודעה לדיירים</h2>
        <button onClick={p.onClose} aria-label="סגור חלון" className="text-ink-500 hover:text-ink-900 px-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-6 overflow-y-auto flex-1 space-y-6">

        {/* Buildings */}
        <Section title="בניינים ודיירים" meta={`${p.selectedBuildings.size} מתוך ${p.buildings.length} בניינים נבחרו`}>
          <div className="border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-ink-50 border-b flex items-center gap-2">
              <svg className="w-4 h-4 text-ink-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="חיפוש בניין..."
                value={p.searchTerm}
                onChange={(e) => p.setSearchTerm(e.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-ink-400"
              />
            </div>
            <div className="px-3 py-1.5 bg-ink-50 border-b flex gap-3 text-xs">
              <button
                className="text-accent-700 font-semibold hover:underline"
                onClick={() => p.setSelectedBuildings(new Set(p.buildings.map((b) => b.id)))}
              >בחר הכל</button>
              <button
                className="text-accent-700 font-semibold hover:underline"
                onClick={() => p.setSelectedBuildings(new Set())}
              >בטל הכל</button>
              <span className="ms-auto text-ink-500 inline-flex items-center gap-1">
                לחץ
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13l-4-4h8l-4 4z" /></svg>
                לראות דירות פר בניין
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filteredBuildings.map((b) => {
                const isSelected = p.selectedBuildings.has(b.id);
                const isExpanded = p.expandedBuildings.has(b.id);
                const tenants = p.recipientsByBuilding[b.id] ?? [];

                return (
                  <div key={b.id} className="border-b last:border-b-0">
                    <div className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-ink-50">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          const next = new Set(p.selectedBuildings);
                          if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                          p.setSelectedBuildings(next);
                        }}
                        className="w-4 h-4 accent-accent-700"
                      />
                      <span className="flex-1 text-sm font-medium">{b.name}</span>
                      <span className="text-xs text-ink-500">{tenants.length} דיירים</span>
                      <button
                        type="button"
                        className={`text-ink-500 inline-flex p-1 rounded transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        onClick={() => {
                          const next = new Set(p.expandedBuildings);
                          if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                          p.setExpandedBuildings(next);
                        }}
                        aria-label="הרחב"
                        aria-expanded={isExpanded}
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13l-4-4h8l-4 4z" /></svg>
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="bg-stone-50 border-t">
                        <div className="px-7 py-1 flex gap-3 text-[11px]">
                          <button
                            className="text-accent-700 font-semibold hover:underline"
                            onClick={() => {
                              const next = new Set(p.excludedTenants);
                              tenants.forEach((t) => next.delete(t.tenant_id));
                              p.setExcludedTenants(next);
                            }}
                          >בחר את כל הדירות</button>
                          <button
                            className="text-accent-700 font-semibold hover:underline"
                            onClick={() => {
                              const next = new Set(p.excludedTenants);
                              tenants.forEach((t) => next.add(t.tenant_id));
                              p.setExcludedTenants(next);
                            }}
                          >בטל את כל הדירות</button>
                        </div>
                        {tenants.length === 0 ? (
                          <div className="px-7 py-2 text-xs text-ink-500">אין דיירים תואמים לפילטרים</div>
                        ) : tenants.map((t) => {
                          const excluded = p.excludedTenants.has(t.tenant_id);
                          const debtBadge = t.current_debt > 0
                            ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-danger-50 text-danger-600">חוב ₪{t.current_debt.toFixed(0)}</span>
                            : <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-100 text-accent-700">שולם</span>;
                          return (
                            <label key={t.tenant_id} className={`flex items-center gap-2 px-7 py-1.5 text-[13px] hover:bg-white cursor-pointer ${!t.is_active ? 'opacity-50' : ''}`}>
                              <input
                                type="checkbox"
                                checked={!excluded}
                                onChange={() => {
                                  const next = new Set(p.excludedTenants);
                                  if (next.has(t.tenant_id)) next.delete(t.tenant_id); else next.add(t.tenant_id);
                                  p.setExcludedTenants(next);
                                }}
                                className="w-3.5 h-3.5 accent-accent-700"
                              />
                              <div className="flex-1">
                                <span className="font-semibold">דירה {t.apartment_number}</span> · {t.tenant_name}
                                <div className="text-[11px] text-ink-500">{t.ownership_type ?? '—'}{!t.is_active ? ' · לא פעיל' : ''}</div>
                              </div>
                              {debtBadge}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        {/* Roles + active toggle */}
        <Section title="סוג בעלות הדירה">
          <div className="flex gap-2 flex-wrap">
            {OWNERSHIP_TYPES.map((r) => {
              const active = p.ownershipTypes.has(r);
              return (
                <button
                  key={r}
                  type="button"
                  className={`px-3.5 py-1.5 rounded-full border text-sm transition ${active ? 'bg-accent-50 border-accent-700 text-accent-700 font-semibold' : 'border-ink-300 hover:border-accent-700'}`}
                  onClick={() => {
                    const next = new Set(p.ownershipTypes);
                    if (next.has(r)) next.delete(r); else next.add(r);
                    p.setOwnershipTypes(next);
                  }}
                >{r}</button>
              );
            })}
            <button
              type="button"
              className={`px-3.5 py-1.5 rounded-full border text-sm transition ${p.includeCommittee ? 'bg-accent-50 border-accent-700 text-accent-700 font-semibold' : 'border-ink-300 hover:border-accent-700'}`}
              onClick={() => p.setIncludeCommittee(!p.includeCommittee)}
            >ועד בית</button>
          </div>
          <label className="mt-3 flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={p.activeOnly}
              onChange={(e) => p.setActiveOnly(e.target.checked)}
              className="accent-accent-700"
            />
            <span>רק חברים פעילים</span>
            <span className="ms-auto text-xs text-ink-500">{p.activeOnly ? 'לא פעילים מוסתרים' : 'כולל לא פעילים'}</span>
          </label>
        </Section>

        {/* Payment status */}
        <Section title="סינון לפי סטטוס תשלום">
          <div className="flex gap-4 flex-wrap text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="status" checked={p.statusFilter === 'has_debt'} onChange={() => p.setStatusFilter('has_debt')} className="accent-accent-700" />
              <span>יש להם חוב</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="status" checked={p.statusFilter === 'all'} onChange={() => p.setStatusFilter('all')} className="accent-accent-700" />
              <span>כל הדיירים</span>
            </label>
          </div>
          {p.statusFilter === 'has_debt' && (
            <div className="mt-2.5 p-3 bg-ink-50 border rounded-xl space-y-1.5 text-sm">
              <div className="text-xs text-ink-500 font-semibold uppercase tracking-wide">תקופת חוב</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="dp" checked={p.debtPeriod === 'current_month'} onChange={() => p.setDebtPeriod('current_month')} className="accent-accent-700" />
                <span>חוב לחודש הנוכחי ({periodLabel})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="dp" checked={p.debtPeriod === 'all_history'} onChange={() => p.setDebtPeriod('all_history')} className="accent-accent-700" />
                <span>חוב בכל תקופה שהיא</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="dp" checked={p.debtPeriod === 'range'} onChange={() => p.setDebtPeriod('range')} className="accent-accent-700" />
                <span>חוב בטווח חודשים</span>
              </label>
              <div className={`flex gap-2 items-center text-xs ps-6 ${p.debtPeriod === 'range' ? '' : 'opacity-40 pointer-events-none'}`}>
                <span>מ-</span>
                <input type="month" value={p.debtFrom} onChange={(e) => p.setDebtFrom(e.target.value)} className="px-2 py-1 border rounded" />
                <span>עד</span>
                <input type="month" value={p.debtTo} onChange={(e) => p.setDebtTo(e.target.value)} className="px-2 py-1 border rounded" />
              </div>
            </div>
          )}
        </Section>

        {/* Templates */}
        <Section title="תבנית הודעה">
          <div className="flex flex-col gap-2">
            {(Object.entries(TEMPLATE_PREVIEWS) as Array<[ReminderTemplateId, typeof TEMPLATE_PREVIEWS.standard]>).map(([k, t]) => (
              <label
                key={k}
                className={`flex gap-2.5 p-3 border rounded-xl cursor-pointer transition ${p.templateId === k ? 'border-accent-700 bg-accent-50' : 'border-ink-300 hover:border-accent-700'}`}
              >
                <input type="radio" name="tpl" checked={p.templateId === k} onChange={() => p.setTemplateId(k)} className="mt-0.5 accent-accent-700" />
                <div>
                  <div className="font-semibold text-sm">{t.title}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{t.preview}</div>
                </div>
              </label>
            ))}
          </div>
          {p.templateId === 'custom' ? (
            <textarea
              className="w-full mt-2.5 p-3 border rounded-xl text-sm min-h-[100px] resize-y focus:border-accent-700 outline-none"
              placeholder="כתוב את ההודעה שלך כאן. אפשר להשתמש ב-{שם}, {דירה}, {בניין}, {סכום}, {תקופה}."
              value={p.customText}
              onChange={(e) => p.setCustomText(e.target.value)}
            />
          ) : (
            <textarea
              className="w-full mt-2.5 p-3 border rounded-xl text-sm min-h-[80px] bg-ink-50 text-ink-500"
              readOnly
              value={TEMPLATE_PREVIEWS[p.templateId].sample}
            />
          )}
        </Section>

        {/* Channel */}
        <Section title="ערוץ שליחה" meta={`סך הכל ${total} דיירים`}>
          <div className="grid grid-cols-3 gap-2.5">
            <ChannelCard
              icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="w-full h-full"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
              name="מייל" count={`${withEmail}/${total} יש מייל`}
              active={p.channel === 'EMAIL'} activeColor="border-primary-600 bg-primary-50" iconColor="text-primary-700"
              onClick={() => p.setChannel('EMAIL')}
            />
            <ChannelCard
              icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="w-full h-full"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>}
              name="WhatsApp" count={`ידני · ${withPhone}/${total}`}
              active={p.channel === 'WHATSAPP_LINK'} activeColor="border-accent-500 bg-accent-50" iconColor="text-accent-700"
              onClick={() => p.setChannel('WHATSAPP_LINK')}
            />
            <ChannelCard
              icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="w-full h-full"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>}
              name="SMS" count={`${withPhone}/${total} יש טלפון`}
              active={p.channel === 'SMS'} activeColor="border-warn-500 bg-warn-50" iconColor="text-warn-600"
              onClick={() => p.setChannel('SMS')}
            />
          </div>
          {note && (
            <div className={`mt-2.5 p-2.5 rounded-lg text-sm ${note.kind === 'warn' ? 'bg-warn-50 text-warn-800' : 'bg-primary-50 text-primary-800'}`}>
              {note.text}
            </div>
          )}
        </Section>

      </div>

      <div className="px-6 py-3 border-t bg-ink-50 flex justify-between items-center gap-3">
        <div className="text-sm text-ink-500">
          {p.isLoading ? 'טוען...' : <>סך הכל <strong className="text-ink-900">{total}</strong> דיירים נבחרו</>}
        </div>
        <div className="flex gap-2.5">
          <button onClick={p.onClose} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-ink-100">ביטול</button>
          <button
            onClick={p.onSubmit}
            disabled={total === 0 || p.isLoading}
            className="px-5 py-2 bg-accent-700 text-white rounded-lg text-sm font-semibold hover:bg-accent-800 disabled:bg-ink-500 disabled:cursor-not-allowed"
          >{buttonLabel}</button>
        </div>
      </div>
    </>
  );
}

// ─── Section helper ──────────────────────────────────────────────────────────

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold text-ink-500 uppercase tracking-wide">{title}</h3>
        {meta && <span className="text-xs text-ink-500">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function ChannelCard({ icon, name, count, active, activeColor, iconColor, onClick }: {
  icon: React.ReactNode; name: string; count: string; active: boolean; activeColor: string; iconColor: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-3.5 border-2 rounded-xl text-center transition ${active ? activeColor : 'border-ink-200 hover:border-accent-700'}`}
    >
      <div className={`w-7 h-7 mx-auto ${active ? iconColor : 'text-ink-500'}`}>{icon}</div>
      <div className="font-bold text-sm mt-1.5">{name}</div>
      <div className="text-xs text-ink-500 mt-0.5">{count}</div>
    </button>
  );
}

// ─── DoneView ────────────────────────────────────────────────────────────────

function DoneView({ summary, onClose }: { summary: DoneSummary; onClose: () => void }) {
  const channelLabel = summary.channel === 'EMAIL' ? 'במייל' : 'ב-SMS';
  const missingField = summary.channel === 'EMAIL' ? 'מייל' : 'טלפון';
  const missingCount = summary.skipped_no_email ?? summary.skipped_no_phone ?? 0;

  return (
    <>
      <div className="px-6 py-4 border-b flex justify-between items-center">
        <h2 className="text-lg font-bold">נשלח בהצלחה</h2>
        <button onClick={onClose} aria-label="סגור חלון" className="text-ink-500 hover:text-ink-900 px-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="p-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-accent-100 text-accent-700 flex items-center justify-center mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-bold mb-1">{summary.sent} הודעות נשלחו {channelLabel}</h2>
        <p className="text-ink-500 text-sm mb-1">הסטטוסים יתעדכנו תוך 1–2 דקות (אישורי מסירה)</p>
        {summary.is_stub && (
          <p className="text-warn-600 text-xs bg-warn-50 inline-flex items-center gap-1.5 px-3 py-1 rounded-full mt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-warn-500" aria-hidden="true" />
            מצב דמו — לא נשלחו הודעות אמיתיות (חסרים credentials)
          </p>
        )}
        <div className="flex justify-center gap-8 my-6 py-4 border-t border-b">
          <div><div className="text-2xl font-bold text-accent-700">{summary.sent}</div><div className="text-xs uppercase text-ink-500 tracking-wide">נשלח</div></div>
          <div><div className="text-2xl font-bold text-accent-700">{summary.failed}</div><div className="text-xs uppercase text-ink-500 tracking-wide">נכשל</div></div>
          <div><div className="text-2xl font-bold text-accent-700">{missingCount}</div><div className="text-xs uppercase text-ink-500 tracking-wide">ללא {missingField}</div></div>
        </div>
        <button onClick={onClose} className="px-5 py-2 bg-accent-700 text-white rounded-lg text-sm font-semibold hover:bg-accent-800">סגור</button>
      </div>
    </>
  );
}

// ─── WhatsAppManualList ──────────────────────────────────────────────────────

function WhatsAppManualList({ items, sentSet, onSend, onClose }: {
  items: WhatsAppBatchItem[];
  sentSet: Set<string>;
  onSend: (item: WhatsAppBatchItem) => void;
  onClose: () => void;
}) {
  const sent = items.filter((i) => sentSet.has(i.tenant_id)).length;
  const pct = items.length ? (sent / items.length) * 100 : 0;
  const closeLabel = sent === items.length && items.length > 0 ? 'סגור' : 'סיים';

  return (
    <>
      <div className="px-6 py-4 border-b flex justify-between items-center">
        <h2 className="text-lg font-bold">שליחה ב-WhatsApp (ידני)</h2>
        <button onClick={onClose} aria-label="סגור חלון" className="text-ink-500 hover:text-ink-900 px-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="px-5 py-3.5 bg-accent-50 border-b flex justify-between items-center gap-3.5">
        <div className="text-sm font-semibold">{sent} מתוך {items.length}</div>
        <div className="flex-1 h-1.5 bg-accent-200/40 rounded overflow-hidden">
          <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-sm font-semibold">{Math.round(pct)}%</div>
      </div>
      <div className="overflow-y-auto flex-1 py-1">
        {items.length === 0 ? (
          <div className="text-center text-ink-500 py-8 text-sm">אין דיירים עם טלפון תקין ברשימה</div>
        ) : items.map((item) => {
          const isSent = sentSet.has(item.tenant_id);
          return (
            <div
              key={item.message_id}
              className={`flex items-center gap-3.5 px-5 py-3 border-b last:border-b-0 ${isSent ? 'bg-accent-50/40' : 'hover:bg-ink-50'}`}
            >
              <div className="flex-1">
                <div className="font-semibold text-sm">
                  {item.tenant_name}
                  <span className="text-xs text-ink-500 font-normal"> · דירה {item.apartment_number} · {item.building_name}</span>
                </div>
                <div className="text-xs text-ink-500 mt-0.5">{item.phone}</div>
              </div>
              {isSent ? (
                <div className="text-accent-700 font-semibold text-sm flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  נשלח
                </div>
              ) : (
                <button
                  onClick={() => onSend(item)}
                  className="bg-accent-500 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold hover:bg-accent-600 inline-flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                  שלח
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="px-6 py-3 border-t bg-ink-50 flex justify-between items-center">
        <div className="text-xs text-ink-500">לחץ "שלח" לכל דייר — ייפתח WhatsApp Web בלשונית חדשה</div>
        <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-white">{closeLabel}</button>
      </div>
    </>
  );
}
