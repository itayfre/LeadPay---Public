import { Link } from 'react-router-dom';

/**
 * Accessibility Statement (הצהרת נגישות) — mandatory under IS 5568.
 * Content is legally required; styling is intentionally minimal.
 * Public route (no auth) so it is always reachable, per regulation.
 */
export default function AccessibilityStatement() {
  return (
    <div className="min-h-screen bg-ink-50 py-12 px-4" dir="rtl" lang="he">
      <main id="main-content" className="max-w-2xl mx-auto">
        <article className="bg-white border rounded-2xl p-6 sm:p-8 shadow-sm">
          <h1 className="text-2xl font-extrabold mb-4">הצהרת נגישות</h1>

          <p className="text-sm sm:text-base text-ink-900 leading-relaxed mb-3">
            LeadPay מחויבת להנגשת המערכת לאנשים עם מוגבלויות בהתאם לתקן הישראלי
            IS 5568, המעוגן בהנחיות WCAG 2.0 ברמה AA.
          </p>

          <p className="text-sm sm:text-base text-ink-900 leading-relaxed mb-3">
            אמצעי הנגישות במערכת כוללים: ניווט מלא באמצעות מקלדת, תאימות לקוראי מסך
            (NVDA, JAWS, VoiceOver), תוויות חלופיות לכפתורים ולאייקונים, וניגודיות
            צבעים ביחס של 4.5:1 לפחות.
          </p>

          <h2 className="text-lg font-bold mt-6 mb-2">פנייה בנושא נגישות</h2>
          <p className="text-sm sm:text-base text-ink-900 leading-relaxed">
            רכז נגישות: <strong>דור מזרחי</strong>
            {' · '}
            טלפון:{' '}
            <a href="tel:+972523000896" className="font-mono text-ink-700 underline" dir="ltr">
              +972 52-3000896
            </a>
            {' · '}
            דוא&quot;ל:{' '}
            <a href="mailto:admin@leadi.co.il" className="font-mono text-ink-700 underline" dir="ltr">
              admin@leadi.co.il
            </a>
          </p>

          <p className="text-xs text-ink-500 mt-6">תאריך עדכון אחרון: 30/05/2026</p>

          <div className="mt-8 pt-4 border-t">
            <Link to="/" className="text-primary-600 hover:text-primary-800 font-semibold underline">
              חזרה לדף הבית
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
