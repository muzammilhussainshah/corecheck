import type { Metadata } from 'next';
import { ComingSoon } from '../../../components/ComingSoon';

export const metadata: Metadata = { title: 'Documents' };

export default function DocumentsPage() {
  return (
    <ComingSoon
      title="Documents"
      summary="Certificates and documents for each item of plant, with verification and expiry tracking."
    />
  );
}
