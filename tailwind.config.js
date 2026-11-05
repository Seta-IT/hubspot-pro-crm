/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Accent segue --sti-accent (redefinido por [data-system] em globals.css).
      colors: {
        accent: { DEFAULT: 'var(--sti-accent)', hover: 'var(--sti-accent-hover)', soft: 'var(--sti-accent-soft)' },
      },
    },
  },
  plugins: [],
};
