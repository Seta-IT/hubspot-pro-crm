/** @type {import('next').NextConfig} */

const HTML_NO_STORE = 'private, no-cache, no-store, must-revalidate';
const STATIC_IMMUTABLE = 'public, max-age=31536000, immutable';

const htmlNoStoreHeaders = [
  { key: 'Cache-Control', value: HTML_NO_STORE },
  { key: 'CDN-Cache-Control', value: 'no-store' },
  { key: 'Cloudflare-CDN-Cache-Control', value: 'no-store' },
];

const staticImmutableHeaders = [
  { key: 'Cache-Control', value: STATIC_IMMUTABLE },
  { key: 'CDN-Cache-Control', value: STATIC_IMMUTABLE },
  { key: 'Cloudflare-CDN-Cache-Control', value: STATIC_IMMUTABLE },
];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async headers() {
    return [
      {
        // Documentos HTML, RSC e APIs: sempre revalidar. Sem isso o Next emite
        // s-maxage=31536000 e o HTML/JS antigo da revisão anterior continua sendo servido.
        source: '/((?!_next/static/).*)',
        headers: htmlNoStoreHeaders,
      },
      {
        // Chunks com hash no nome podem (e devem) ser imutáveis.
        source: '/_next/static/:path*',
        headers: staticImmutableHeaders,
      },
    ];
  },
};

export default nextConfig;
