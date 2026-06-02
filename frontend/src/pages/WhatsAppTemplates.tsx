import { useState } from 'react';
import Layout from '../components/layout/Layout';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

interface Template {
  id: string;
  name: string;
  label: string;
  language: 'he' | 'en';
  content: string;
}

const defaultTemplates: Template[] = [
  {
    id: 'payment_reminder_he',
    name: 'payment_reminder',
    label: 'תזכורת תשלום',
    language: 'he',
    content: `שלום {tenant_name},

תזכורת ידידותית לתשלום דמי הבית עבור {building_name}.

🏠 דירה: {apartment_number}
💰 סכום לתשלום: {amount}₪
📅 תקופה: {period}

אנא העבירו את התשלום בהקדם האפשרי.

תודה רבה!`,
  },
  {
    id: 'payment_reminder_en',
    name: 'payment_reminder',
    label: 'Payment Reminder',
    language: 'en',
    content: `Hello {tenant_name},

Friendly reminder for your building payment for {building_name}.

🏠 Apartment: {apartment_number}
💰 Amount due: ₪{amount}
📅 Period: {period}

Please transfer the payment as soon as possible.

Thank you!`,
  },
  {
    id: 'payment_received_he',
    name: 'payment_received',
    label: 'אישור קבלת תשלום',
    language: 'he',
    content: `שלום {tenant_name},

קיבלנו את תשלומך עבור דמי הבית!

🏠 דירה: {apartment_number}
💰 סכום: {amount}₪
✅ התקבל בהצלחה

תודה רבה!`,
  },
  {
    id: 'payment_received_en',
    name: 'payment_received',
    label: 'Payment Received',
    language: 'en',
    content: `Hello {tenant_name},

We received your building payment!

🏠 Apartment: {apartment_number}
💰 Amount: ₪{amount}
✅ Received successfully

Thank you!`,
  },
];

export default function WhatsAppTemplates() {
  const [templates, setTemplates] = useState<Template[]>(defaultTemplates);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (!editingTemplate) return;

    setTemplates(templates.map(t =>
      t.id === editingTemplate.id ? editingTemplate : t
    ));
    setEditingTemplate(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleReset = (templateId: string) => {
    const defaultTemplate = defaultTemplates.find(t => t.id === templateId);
    if (defaultTemplate) {
      setTemplates(templates.map(t =>
        t.id === templateId ? defaultTemplate : t
      ));
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-ink-900">תבניות WhatsApp</h1>
          <p className="text-sm text-ink-500 mt-1">ערוך את תבניות ההודעות שנשלחות לדיירים</p>
        </div>

        {/* Success Message */}
        {saved && (
          <div className="bg-accent-50 ring-1 ring-accent-200 rounded-lg p-4">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-accent-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="font-semibold text-accent-700">השינויים נשמרו בהצלחה!</p>
            </div>
          </div>
        )}

        {/* Templates Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 border-b border-ink-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink-900 text-[15px] truncate">{template.label}</h3>
                    <p className="text-[13px] text-ink-500">
                      {template.language === 'he' ? 'עברית' : 'English'}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setEditingTemplate(template)}>
                    ערוך
                  </Button>
                </div>
              </div>

              {/* Preview */}
              <div className="p-4">
                <div className="bg-ink-50 rounded-lg p-4 ring-1 ring-ink-200">
                  <pre className="text-sm text-ink-700 whitespace-pre-wrap font-sans" dir={template.language === 'he' ? 'rtl' : 'ltr'}>
                    {template.content}
                  </pre>
                </div>
                <button
                  onClick={() => handleReset(template.id)}
                  className="mt-3 text-sm text-ink-500 hover:text-ink-900 underline"
                >
                  אפס לברירת מחדל
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Variables Help */}
        <div className="bg-primary-50 ring-1 ring-primary-200 rounded-xl p-6">
          <h3 className="font-semibold text-primary-900 text-[15px] mb-4">משתנים זמינים</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-white rounded-lg p-3 border border-primary-200">
              <code className="font-mono text-primary-700">{'{tenant_name}'}</code>
              <p className="text-ink-700 mt-1">שם הדייר</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-primary-200">
              <code className="font-mono text-primary-700">{'{building_name}'}</code>
              <p className="text-ink-700 mt-1">שם הבניין</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-primary-200">
              <code className="font-mono text-primary-700">{'{apartment_number}'}</code>
              <p className="text-ink-700 mt-1">מספר דירה</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-primary-200">
              <code className="font-mono text-primary-700">{'{amount}'}</code>
              <p className="text-ink-700 mt-1">סכום</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-primary-200">
              <code className="font-mono text-primary-700">{'{period}'}</code>
              <p className="text-ink-700 mt-1">תקופה</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-primary-200">
              <code className="font-mono text-primary-700">{'{custom_message}'}</code>
              <p className="text-ink-700 mt-1">הודעה מותאמת</p>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingTemplate && (
        <Modal open onClose={() => setEditingTemplate(null)} srTitle={editingTemplate.label} size="3xl" hideClose className="max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-ink-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-ink-900">{editingTemplate.label}</h3>
                <button
                  onClick={() => setEditingTemplate(null)}
                  aria-label="סגור חלון"
                  className="w-10 h-10 flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-ink-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              <label htmlFor="wt-content" className="block text-[13px] font-medium text-ink-700 mb-2">
                תוכן התבנית
              </label>
              <textarea
                id="wt-content"
                value={editingTemplate.content}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                className="w-full h-80 px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors font-sans"
                dir={editingTemplate.language === 'he' ? 'rtl' : 'ltr'}
                placeholder="הקלד את תוכן ההודעה כאן..."
              />
              <p className="text-sm text-ink-500 mt-2">
                השתמש במשתנים כמו {'{tenant_name}'}, {'{amount}'}, וכו׳
              </p>
            </div>

            {/* Modal Footer */}
            <div className="bg-ink-50 px-6 py-4 flex gap-3 justify-end border-t border-ink-100">
              <Button variant="secondary" onClick={() => setEditingTemplate(null)}>
                ביטול
              </Button>
              <Button onClick={handleSave}>
                שמור שינויים
              </Button>
            </div>
        </Modal>
      )}
    </Layout>
  );
}
