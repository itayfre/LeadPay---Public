import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type BuildingTab = 'summary' | 'collection' | 'expenses';

interface Props {
  activeTab: BuildingTab;
  onChange: (tab: BuildingTab) => void;
}

export default function BuildingTabs({ activeTab, onChange }: Props) {
  const { t } = useTranslation();

  const tabs: Array<{ id: BuildingTab; label: string; icon: ReactNode }> = [
    { id: 'summary', label: t('building.tabs.summary'), icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    ) },
    { id: 'collection', label: t('building.tabs.collection'), icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    ) },
    { id: 'expenses', label: t('building.tabs.expenses'), icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    ) },
  ];

  return (
    <div
      className="bg-ink-100 rounded-xl p-1 flex gap-1"
      role="tablist"
      dir="rtl"
      aria-label={t('building.tabs.aria_label')}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
          className={[
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5',
            'rounded-lg text-sm font-medium transition-all duration-150',
            activeTab === tab.id
              ? 'bg-white text-ink-900 shadow-sm'
              : 'text-ink-500 hover:text-ink-700 hover:bg-ink-200/60',
          ].join(' ')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">{tab.icon}</svg>
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
