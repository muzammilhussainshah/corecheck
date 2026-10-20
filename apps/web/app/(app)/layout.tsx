import { AppFrame } from '../../components/AppFrame';

export default function SignedInLayout({ children }: LayoutProps<'/'>) {
  return <AppFrame>{children}</AppFrame>;
}
