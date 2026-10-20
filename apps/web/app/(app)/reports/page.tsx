import type { Metadata } from 'next';
import { ComingSoon } from '../../../components/ComingSoon';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      summary="Standard compliance, check and Defect reports with filters and Excel, CSV and PDF exports."
    />
  );
}
