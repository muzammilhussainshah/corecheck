import { PortalFrame } from '../../components/PortalFrame';

export default function PortalLayout({ children }: LayoutProps<'/'>) {
  return <PortalFrame>{children}</PortalFrame>;
}
