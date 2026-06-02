/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        ink: {
          50:  '#F8FAFB',
          100: '#F1F3F5',
          200: '#E2E6EB',
          300: '#B9C0C9',
          400: '#8C95A1',
          500: '#6B7480',
          600: '#545E69',
          700: '#3D4852',
          800: '#1F2630',
          900: '#11161A',
          950: '#0B0F0E',
        },
        // accent / warn / danger carry full 50–900 scales (emerald / amber / red)
        // so the token system fully absorbs the old palette with no missing shades.
        accent: {
          50:  '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7', 400: '#34D399',
          500: '#10B981', 600: '#059669', 700: '#047857', 800: '#065F46', 900: '#064E3B',
        },
        danger: {
          50:  '#FEF2F2', 100: '#FEE2E2', 200: '#FECACA', 300: '#FCA5A5', 400: '#F87171',
          500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B', 900: '#7F1D1D',
        },
        warn: {
          50:  '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#FBBF24',
          500: '#F59E0B', 600: '#D97706', 700: '#B45309', 800: '#92400E', 900: '#78350F',
        },
      },
    },
  },
  plugins: [],
}
