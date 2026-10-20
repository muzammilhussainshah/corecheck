import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import { APP_NAME } from '@corecheck/shared';
// globals.css first: it declares the cascade-layer order that Mantine's
// layered stylesheets slot into.
import './globals.css';
import '@mantine/core/styles.layer.css';
import 'react-toastify/dist/ReactToastify.css';
import '@mantine/dates/styles.layer.css';
import { Providers } from './providers';

// The CoreStock type pair: Satoshi for text, Manrope for headings.
const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-Regular.otf', weight: '400' },
    { path: './fonts/Satoshi-Medium.otf', weight: '500' },
    { path: './fonts/Satoshi-Bold.otf', weight: '700' },
  ],
  display: 'swap',
  variable: '--font-satoshi',
});
const manrope = localFont({
  src: [
    { path: './fonts/Manrope-SemiBold.ttf', weight: '600' },
    { path: './fonts/Manrope-Bold.ttf', weight: '700' },
  ],
  display: 'swap',
  variable: '--font-manrope',
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME} Admin`, template: `%s · ${APP_NAME} Admin` },
  description: 'Internal CoreCheck administration',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en-GB"
      className={`${satoshi.variable} ${manrope.variable}`}
      {...mantineHtmlProps}
    >
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
