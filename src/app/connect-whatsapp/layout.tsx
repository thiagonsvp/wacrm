import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function ConnectWhatsappLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-8">
      {children}
    </main>
  );
}
