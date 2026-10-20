import type { NextConfig } from 'next';

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No location capture anywhere in CoreCheck (EVD-004).
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(), microphone=(), payment=()',
  },
];

const nextConfig: NextConfig = {
  // Shared UI components are published as TypeScript source.
  transpilePackages: ['@corecheck/ui'],

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

  async rewrites() {
    // Same arrangement as CoreStock: the browser calls /api/* on this origin
    // and Next forwards it to the API, so the API needs no CORS setup and the
    // session cookie stays first-party. BACKEND_URL defaults to the API
    // running locally; point it at staging to work against that instead.
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
