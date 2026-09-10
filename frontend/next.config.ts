import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.UNIEXAM_E2E==='true'?'.next-e2e':'.next',
  transpilePackages: ['@uniexam/contracts'],
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: "frame-src 'self' blob:; object-src 'none'; base-uri 'self'" },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
export default config;
