import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

/** Map the leading path segment to a nav translation key for the breadcrumb. */
const SEGMENT_KEY: Record<string, string> = {
  '': 'nav.buildings',
  buildings: 'nav.buildings',
  tenants: 'nav.tenants',
  statements: 'nav.statements',
  transactions: 'nav.transactions',
  settings: 'nav.settings',
  users: 'nav.users',
};

export default function Layout({ children }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'he' ? 'en' : 'he');
  };

  const segment = location.pathname.split('/')[1] ?? '';
  const pageKey = SEGMENT_KEY[segment];

  return (
    <div className="min-h-screen bg-ink-50 flex">
      {/* Skip to content (WCAG 2.4.1 / IS 5568) */}
      <a href="#main-content" className="skip-link">דלג לתוכן הראשי</a>

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Bar */}
        <header role="banner" className="h-16 bg-white border-b border-ink-200 flex items-center justify-between px-6 sticky top-0 z-30">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.menu', { defaultValue: 'תפריט' })}
            className="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-ink-100 transition-colors"
          >
            <svg className="w-6 h-6 text-ink-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Breadcrumb — real context, not a static greeting */}
          <nav aria-label="פירורי לחם" className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-ink-500 truncate">{t('breadcrumb.home')}</span>
            {pageKey && (
              <>
                <svg className="w-4 h-4 text-ink-300 shrink-0 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-semibold text-ink-900 truncate">{t(pageKey)}</span>
              </>
            )}
          </nav>

          {/* Right Side Actions — language only; profile lives in the sidebar */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLanguage}
              className="px-3 h-10 rounded-lg text-sm font-medium text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100 transition-colors"
              aria-label="Toggle language"
            >
              {i18n.language === 'he' ? 'EN' : 'עב'}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main id="main-content" tabIndex={-1} className="flex-1 p-6 lg:p-8 overflow-auto">
          {children}
        </main>

        {/* Footer */}
        <footer role="contentinfo" className="border-t border-ink-200 bg-white px-6 py-3 text-sm text-ink-500 flex items-center justify-between">
          <span>© LeadPay</span>
          <a
            href="/accessibility-statement"
            className="text-primary-600 hover:text-primary-800 font-medium underline"
          >
            הצהרת נגישות
          </a>
        </footer>
      </div>
    </div>
  );
}
