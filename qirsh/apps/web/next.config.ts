import type { NextConfig } from "next";

// Built with webpack (`next build --webpack`): Turbopack currently mangles the Emscripten loader
// that PGlite, the in-browser Postgres of the demo, uses to start its WebAssembly module.
const nextConfig: NextConfig = {
  transpilePackages: ["@qirsh/db", "@qirsh/money"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
