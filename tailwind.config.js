/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // IBM Plex Sans/Mono are drawn together from one type family (an engineering-heritage
        // pairing, not the Roboto everyone's Tailwind starter reaches for) - a deliberate choice
        // for a network/infrastructure tool rather than a generic SaaS default.
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        aws: {
          squid: '#232f3e',
          dark: '#161e2e',
          orange: '#ff9900',
          smile: '#ff9900',
          blue: '#0073bb',
          sky: '#527fff',
          paper: '#f2f3f3',
          border: '#374151',
        },
        // The app's one deliberate interactive accent - a deep circuit teal, standing in for
        // every previous ad-hoc use of Tailwind's stock blue/indigo/sky (three different
        // "generic blues" used interchangeably across the app for the same job). Chosen to sit
        // clearly apart from the semantic status colors (emerald = healthy, amber = degraded,
        // rose = failed) so it never gets mistaken for one of them.
        circuit: {
          50: '#EDFAFA',
          100: '#D2F3F3',
          200: '#A8E6E7',
          300: '#74D2D4',
          400: '#3FB4B8',
          500: '#1E9498',
          600: '#12797E',
          700: '#106166',
          800: '#114E52',
          900: '#124345',
          950: '#062527',
        }
      },
      // Tightened, cooler-tinted scale so every existing rounded-*/shadow-* class in the app
      // renders less like the identical-soft-card SaaS default and more like a precise
      // instrument panel - overriding the token values themselves means no component markup
      // has to change to pick this up.
      borderRadius: {
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.875rem',
      },
      boxShadow: {
        xs: '0 1px 1px 0 rgba(18, 23, 31, 0.04)',
        sm: '0 1px 2px 0 rgba(18, 23, 31, 0.06), 0 1px 1px -1px rgba(18, 23, 31, 0.04)',
        DEFAULT: '0 1px 2px 0 rgba(18, 23, 31, 0.06), 0 1px 1px -1px rgba(18, 23, 31, 0.04)',
        md: '0 2px 4px -1px rgba(18, 23, 31, 0.08), 0 1px 2px -1px rgba(18, 23, 31, 0.05)',
        lg: '0 4px 8px -2px rgba(18, 23, 31, 0.10), 0 2px 4px -2px rgba(18, 23, 31, 0.06)',
        xl: '0 8px 16px -4px rgba(18, 23, 31, 0.12), 0 4px 6px -4px rgba(18, 23, 31, 0.06)',
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      }
    },
  },
  plugins: [],
}
