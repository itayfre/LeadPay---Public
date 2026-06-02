import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';
import en from './locales/en.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      he: { translation: he },
      en: { translation: en },
    },
    lng: 'he', // Default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

// Flip document direction and lang attribute when language changes
function applyDirection(lng: string) {
  document.documentElement.dir  = lng === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
}

// Apply immediately on load
applyDirection(i18n.language);

// Apply on every language change
i18n.on('languageChanged', applyDirection);

export default i18n;
