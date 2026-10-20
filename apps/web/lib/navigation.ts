import {
  IconAlertTriangle,
  IconBuildingFactory2,
  IconChartBar,
  IconChecklist,
  IconFileCertificate,
  IconHome,
  IconListDetails,
  IconMapPin,
  IconShieldCheck,
  IconTool,
  IconUsers,
  IconUsersGroup,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import type { PermissionCode } from '@corecheck/shared';

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  /** Shown when the user holds any of these (NAV-004). */
  anyOf?: PermissionCode[];
}

/** Role-sensitive navigation (NAV-001, NAV-003). */
export const MAIN_NAV: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: IconHome },
  {
    label: 'Plant',
    href: '/plant',
    icon: IconBuildingFactory2,
    anyOf: ['plant.view'],
  },
  {
    label: 'Checks',
    href: '/checks',
    icon: IconChecklist,
    anyOf: ['checks.view'],
  },
  {
    label: 'Defects',
    href: '/defects',
    icon: IconAlertTriangle,
    anyOf: ['defects.view'],
  },
  {
    label: 'Documents',
    href: '/documents',
    icon: IconFileCertificate,
    anyOf: ['documents.view'],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: IconChartBar,
    anyOf: ['reports.view'],
  },
];

export const ADMIN_NAV: NavItem[] = [
  {
    label: 'Users',
    href: '/admin/users',
    icon: IconUsers,
    anyOf: ['users.view'],
  },
  {
    label: 'Roles',
    href: '/admin/roles',
    icon: IconShieldCheck,
    anyOf: ['roles.view'],
  },
  {
    label: 'Sites',
    href: '/admin/sites',
    icon: IconMapPin,
    anyOf: ['org_structure.manage'],
  },
  {
    label: 'Teams',
    href: '/admin/teams',
    icon: IconUsersGroup,
    anyOf: ['org_structure.manage'],
  },
  {
    label: 'Disciplines',
    href: '/admin/disciplines',
    icon: IconTool,
    anyOf: ['org_structure.manage'],
  },
  {
    label: 'Security audit',
    href: '/admin/audit',
    icon: IconListDetails,
    anyOf: ['audit.view_security'],
  },
];

export const isActive = (pathname: string, href: string): boolean =>
  href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);
