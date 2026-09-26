import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Attendance Portal – Smart Class Attendance',
  description:
    'Secure, location-aware attendance system with WebAuthn biometric authentication for universities and schools.',
  keywords: ['attendance', 'university', 'WebAuthn', 'biometric', 'class management'],
  openGraph: {
    title: 'Attendance Portal',
    description: 'Smart Class Attendance with WebAuthn & Geolocation',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
