import type { NextConfig } from "next";
import webpack from "webpack";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  async headers() {
    // Every write in this app is a real wallet-signed transaction
    // (create_rein / fund_bond / submit_action / adjudicate) triggered
    // from a button click -- frame-ancestors 'none' stops the page from
    // being embedded in a hidden/disguised iframe on another site for a
    // clickjacking attempt against those buttons.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // wagmi's default connector set transitively pulls in optional
    // packages REIN never uses -- see rainbowkit-wagmi-nextjs-gotchas.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@react-native-async-storage\/async-storage$/ })
    );
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^pino-pretty$/ }));
    return config;
  },
};

export default nextConfig;
