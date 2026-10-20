import type { Metadata } from 'next';
import { ComingSoon } from '../../../components/ComingSoon';

export const metadata: Metadata = { title: 'Defects' };

export default function DefectsPage() {
  return (
    <ComingSoon
      title="Defects"
      summary="Defects raised from failed checks, corrective work, verification and return to service."
    />
  );
}
