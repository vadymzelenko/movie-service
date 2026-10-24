import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@movie/shared'],
  // Дев-сервер открывают с телефона по LAN-IP — разрешаем такие origin'ы для HMR.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'],
  images: { unoptimized: true },
};

export default nextConfig;
