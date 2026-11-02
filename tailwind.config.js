/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Cor de destaque única do sistema (azul-marinho #1e3a6e), espelhando --sti-accent em globals.css.
      colors: {
        accent: { DEFAULT: '#1e3a6e', hover: '#162d57', soft: '#eef2f8' },
      },
    },
  },
  plugins: [],
};
