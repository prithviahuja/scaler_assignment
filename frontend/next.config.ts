import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Avatars are initials-on-a-tile, so no remote image loader is needed.
  images: { unoptimized: true },
};

export default nextConfig;
