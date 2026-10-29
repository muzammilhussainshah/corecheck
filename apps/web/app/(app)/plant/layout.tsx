import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Plant' };

export default function PlantLayout({ children }: { children: ReactNode }) {
  return children;
}
