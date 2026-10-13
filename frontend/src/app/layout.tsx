import type { Metadata } from 'next';
import 'lenis/dist/lenis.css';
import '../styles/globals.css';
import SmoothScroll from '@/components/SmoothScroll';

export const metadata: Metadata = {
  title: 'Mantis — Spec-free API testing for Node.js and Express',
  description:
    'Point Mantis at your backend. It reads the code, maps every endpoint, and tests them safely. Then it shows you where your API breaks and the exact line to look at.',
  icons: {
    icon: '/assets/logos/mantislogo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
