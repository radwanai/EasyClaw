import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ClawdBot — Control Plane",
  description: "Multi-tenant provisioning for ClawdBot personal assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <Providers>
          <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold">ClawdBot</h1>
              <span className="text-sm text-gray-500">Control Plane</span>
            </div>
          </nav>
          <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
