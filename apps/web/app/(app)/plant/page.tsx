import type { Metadata } from 'next';
import { ComingSoon } from '../../../components/ComingSoon';

export const metadata: Metadata = { title: 'Plant' };

export default function PlantPage() {
  return (
    <ComingSoon
      title="Plant"
      summary="Plant register: plant types, ownership, locations, QR codes, reception and approval, with each item's documents and history."
    />
  );
}
