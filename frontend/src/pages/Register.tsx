import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface Building {
  id: string;
  name: string;
}

interface FormData {
  full_name: string;
  email: string;
  password: string;
  confirmPassword: string;
  building_id: string;
}

const Register: React.FC = () => {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [formData, setFormData] = useState<FormData>({
    full_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    building_id: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Try to load buildings list for the select field
    fetch(`${API_BASE_URL}/api/v1/buildings/`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setBuildings(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setFormData(prev => ({ ...prev, [field]: e.target.value }));

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
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          password: formData.password,
          building_id: formData.building_id || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'שגיאה בהרשמה');
      }
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'שגיאה בהרשמה');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 bg-accent-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-accent-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">בקשתך התקבלה!</h2>
          <p className="text-ink-500 mb-2">ההרשמה שלך נקלטה בהצלחה.</p>
          <p className="text-ink-500 mb-6 text-sm">מנהל הבניין יאשר את חשבונך בקרוב ותוכל להתחבר.</p>
          <Link to="/login" className="text-primary-600 hover:underline font-medium">
            חזרה לדף הכניסה
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm w-full max-w-md p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-ink-900">הרשמה כדייר</h1>
          <p className="text-ink-500 mt-1 text-sm">צור חשבון לגישה למידע על הבניין שלך</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reg-name" className="block text-[13px] font-medium text-ink-700 mb-1.5">שם מלא</label>
            <input
              id="reg-name"
              type="text"
              required
              value={formData.full_name}
              onChange={handleChange('full_name')}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
              placeholder="ישראל ישראלי"
            />
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-[13px] font-medium text-ink-700 mb-1.5">אימייל</label>
            <input
              id="reg-email"
              type="email"
              required
              value={formData.email}
              onChange={handleChange('email')}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              dir="ltr"
              placeholder="your@email.com"
            />
          </div>

          {buildings.length > 0 && (
            <div>
              <label htmlFor="reg-building" className="block text-[13px] font-medium text-ink-700 mb-1.5">בניין</label>
              <select
                id="reg-building"
                value={formData.building_id}
                onChange={handleChange('building_id')}
                className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
              >
                <option value="">-- בחר בניין --</option>
                {buildings.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="reg-password" className="block text-[13px] font-medium text-ink-700 mb-1.5">סיסמה</label>
            <input
              id="reg-password"
              type="password"
              required
              value={formData.password}
              onChange={handleChange('password')}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
              placeholder="לפחות 8 תווים"
            />
          </div>

          <div>
            <label htmlFor="reg-confirm" className="block text-[13px] font-medium text-ink-700 mb-1.5">אימות סיסמה</label>
            <input
              id="reg-confirm"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={handleChange('confirmPassword')}
              className="w-full px-4 py-3 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
              placeholder="הזן שוב את הסיסמה"
            />
          </div>

          {error && (
            <div className="bg-danger-50 ring-1 ring-danger-200 text-danger-600 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Button type="submit" disabled={isLoading} className="w-full py-3 h-auto">
            {isLoading ? 'שולח...' : 'הירשם'}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm text-ink-500">
          יש לך כבר חשבון?{' '}
          <Link to="/login" className="text-primary-600 hover:underline font-medium">כניסה</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
