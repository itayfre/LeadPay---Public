import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, TOKEN_KEYS } from '../services/api';
import Button from '../components/ui/Button';

export default function Setup() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [formData, setFormData] = useState({ email: '', full_name: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (user) { navigate('/buildings'); return; }

    // Check if setup is still needed + if backend is reachable
    fetch(`${API_BASE_URL}/api/v1/auth/setup/status`)
      .then(async r => {
        setBackendReady(r.ok);
        const data = await r.json();
        if (!data.setup_needed) navigate('/login');
      })
      .catch(() => setBackendReady(false)) // backend not reachable yet
      .finally(() => setChecking(false));
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('הסיסמאות אינן תואמות');
      return;
    }
    if (formData.password.length < 8) {
      setError('הסיסמה חייבת להכיל לפחות 8 תווים');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          password: formData.password,
        }),
      });

      // Safely parse response — body may be empty on server errors
      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }

      if (!res.ok) {
        // Give a human-readable error in any case
        const detail = data.detail || `שגיאת שרת (${res.status})`;
        if (res.status === 404 || res.status === 0) {
          throw new Error('השרת עדיין לא מוכן — המתן דקה ונסה שוב (Railway עדיין מתעדכן)');
        }
        if (res.status === 403) {
          throw new Error('חשבון מנהל כבר קיים. עבור לדף הכניסה.');
        }
        if (res.status >= 500) {
          throw new Error('שגיאת שרת — ייתכן שהמסד נתונים לא הוכן עדיין. בדוק את לוגים ב-Railway.');
        }
        throw new Error(detail);
      }

      // Store tokens and redirect
      localStorage.setItem(TOKEN_KEYS.ACCESS, data.access_token);
      localStorage.setItem(TOKEN_KEYS.REFRESH, data.refresh_token);
      window.location.href = '/buildings'; // hard reload so AuthContext picks up the new token
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm p-8 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-600 rounded-xl mb-3">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink-900">LeadPay</h1>
          <p className="text-ink-500 text-sm mt-1">הגדרה ראשונית</p>
        </div>

        {/* Banner */}
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 mb-3 text-sm text-primary-800 text-right">
          <strong>ברוך הבא!</strong> צור את חשבון המנהל הראשון. פעולה זו ניתנת לביצוע פעם אחת בלבד.
        </div>

        {/* Backend status */}
        <div className={`flex items-center gap-2 justify-end mb-4 text-sm px-1 ${
          backendReady === null ? 'text-ink-500' :
          backendReady ? 'text-accent-600' : 'text-danger-500'
        }`}>
          <span>
            {backendReady === null && 'בודק חיבור לשרת...'}
            {backendReady === true && 'השרת מוכן'}
            {backendReady === false && 'השרת לא מגיב — Railway עדיין מתעדכן, המתן ורענן'}
          </span>
          <span className={`w-2.5 h-2.5 rounded-full ${
            backendReady === null ? 'bg-ink-300 animate-pulse' :
            backendReady ? 'bg-accent-500' : 'bg-danger-400 animate-pulse'
          }`} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="setup-name" className="block text-[13px] font-medium text-ink-700 mb-1.5 text-right">שם מלא</label>
            <input
              id="setup-name"
              type="text"
              required
              placeholder="ישראל ישראלי"
              className="w-full px-3 py-2.5 rounded-lg ring-1 ring-ink-200 text-right focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={formData.full_name}
              onChange={e => setFormData(p => ({ ...p, full_name: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="setup-email" className="block text-[13px] font-medium text-ink-700 mb-1.5 text-right">כתובת אימייל</label>
            <input
              id="setup-email"
              type="email"
              required
              placeholder="admin@example.com"
              className="w-full px-3 py-2.5 rounded-lg ring-1 ring-ink-200 text-right focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={formData.email}
              onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="setup-password" className="block text-[13px] font-medium text-ink-700 mb-1.5 text-right">סיסמה (לפחות 8 תווים)</label>
            <input
              id="setup-password"
              type="password"
              required
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg ring-1 ring-ink-200 text-right focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={formData.password}
              onChange={e => setFormData(p => ({ ...p, password: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="setup-confirm" className="block text-[13px] font-medium text-ink-700 mb-1.5 text-right">אימות סיסמה</label>
            <input
              id="setup-confirm"
              type="password"
              required
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg ring-1 ring-ink-200 text-right focus:outline-none focus:ring-2 focus:ring-primary-500"
              value={formData.confirmPassword}
              onChange={e => setFormData(p => ({ ...p, confirmPassword: e.target.value }))}
            />
          </div>

          {error && (
            <div className="bg-danger-50 ring-1 ring-danger-200 rounded-lg p-3 text-sm text-danger-600 text-right">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'יוצר חשבון...' : 'צור חשבון מנהל'}
          </Button>
        </form>
      </div>
    </div>
  );
}
