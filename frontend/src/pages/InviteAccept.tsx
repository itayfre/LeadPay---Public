import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { TOKEN_KEYS } from '../services/api';
import Button from '../components/ui/Button';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface InviteData {
  email: string;
  full_name: string;
  role: string;
}

const roleLabels: Record<string, string> = {
  manager: 'מנהל',
  worker: 'עובד',
  viewer: 'צופה',
  tenant: 'דייר',
};

const InviteAccept: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [formData, setFormData] = useState({ full_name: '', password: '', confirmPassword: '' });
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPageError('קישור לא תקף');
      setIsLoading(false);
      return;
    }
    fetch(`${API_BASE_URL}/api/v1/auth/invite/${token}`)
      .then(r => {
        if (!r.ok) throw new Error('הקישור לא תקף או שפג תוקפו');
        return r.json();
      })
      .then((data: InviteData) => {
        setInviteData(data);
        setFormData(prev => ({ ...prev, full_name: data.full_name }));
      })
      .catch(err => setPageError(err.message))
      .finally(() => setIsLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (formData.password !== formData.confirmPassword) {
      setFormError('הסיסמאות אינן תואמות');
      return;
    }
    if (formData.password.length < 8) {
      setFormError('הסיסמה חייבת להכיל לפחות 8 תווים');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: formData.full_name, password: formData.password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'שגיאה בהגדרת החשבון');
      }
      const data = await res.json();
      localStorage.setItem(TOKEN_KEYS.ACCESS, data.access_token);
      localStorage.setItem(TOKEN_KEYS.REFRESH, data.refresh_token);
      window.location.href = '/buildings';
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm max-w-md w-full p-8 text-center">
          <div className="w-14 h-14 bg-danger-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-danger-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">קישור לא תקף</h2>
          <p className="text-danger-600 mb-4">{pageError}</p>
          <a href="/login" className="text-primary-600 hover:underline">חזרה לדף הכניסה</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-primary-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink-900">הגדרת חשבון</h1>
          <p className="text-ink-500 mt-1 text-sm" dir="ltr">{inviteData?.email}</p>
          <span className="inline-block mt-2 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">
            {roleLabels[inviteData?.role ?? ''] ?? inviteData?.role}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="inv-name" className="block text-[13px] font-medium text-ink-700 mb-1.5">שם מלא</label>
            <input
              id="inv-name"
              type="text"
              required
              value={formData.full_name}
              onChange={e => setFormData(p => ({ ...p, full_name: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
            />
          </div>

          <div>
            <label htmlFor="inv-password" className="block text-[13px] font-medium text-ink-700 mb-1.5">סיסמה חדשה</label>
            <input
              id="inv-password"
              type="password"
              required
              value={formData.password}
              onChange={e => setFormData(p => ({ ...p, password: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
              placeholder="לפחות 8 תווים"
            />
          </div>

          <div>
            <label htmlFor="inv-confirm" className="block text-[13px] font-medium text-ink-700 mb-1.5">אימות סיסמה</label>
            <input
              id="inv-confirm"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={e => setFormData(p => ({ ...p, confirmPassword: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
            />
          </div>

          {formError && (
            <div className="bg-danger-50 ring-1 ring-danger-200 text-danger-600 px-4 py-3 rounded-lg text-sm">
              {formError}
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full py-3 h-auto">
            {isSubmitting ? 'שומר...' : 'הגדר חשבון והיכנס'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default InviteAccept;
