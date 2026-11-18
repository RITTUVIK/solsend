import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@solsend/shared"],
  poweredByHeader: false,
  serverExternalPackages: [],
  // packages/shared is TS-source ESM with ".js" specifiers (NodeNext style) — map them to .ts for webpack.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};
export default nextConfig;
