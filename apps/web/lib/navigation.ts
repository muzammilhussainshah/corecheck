import {
  IconAlertTriangle,
  IconBuildingFactory2,
  IconBuildingStore,
  IconBulldozer,
  IconCategory,
  IconChartBar,
  IconChecklist,
  IconClipboardList,
  IconFileCertificate,
  IconForms,
  IconGauge,
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
  /** Heading the item sits under on the Manage page. */
  group?: string;
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
    group: 'Organisation',
  },
  {
    label: 'Roles',
    href: '/admin/roles',
    icon: IconShieldCheck,
    anyOf: ['roles.view'],
    group: 'Organisation',
  },
  {
    label: 'Sites',
    href: '/admin/sites',
    icon: IconMapPin,
    anyOf: ['org_structure.manage'],
    group: 'Organisation',
  },
  {
    label: 'Teams',
    href: '/admin/teams',
    icon: IconUsersGroup,
    anyOf: ['org_structure.manage'],
    group: 'Organisation',
  },
  {
    label: 'Disciplines',
    href: '/admin/disciplines',
    icon: IconTool,
    anyOf: ['org_structure.manage'],
    group: 'Organisation',
  },
  {
    label: 'Plant types',
    href: '/admin/plant-types',
    icon: IconBulldozer,
    anyOf: ['plant_config.manage'],
    group: 'Plant',
  },
  {
    label: 'Categories',
    href: '/admin/plant-categories',
    icon: IconCategory,
    anyOf: ['plant_config.manage'],
    group: 'Plant',
  },
  {
    label: 'Companies',
    href: '/admin/plant-companies',
    icon: IconBuildingStore,
    anyOf: ['plant_config.manage'],
    group: 'Plant',
  },
  {
    label: 'Custom fields',
    href: '/admin/custom-fields',
    icon: IconForms,
    anyOf: ['plant_config.manage'],
    group: 'Plant',
  },
  {
    label: 'Meter types',
    href: '/admin/meter-types',
    icon: IconGauge,
    anyOf: ['meters.configure'],
    group: 'Plant',
  },
  {
    label: 'Document types',
    href: '/admin/document-types',
    icon: IconFileCertificate,
    anyOf: ['documents.configure'],
    group: 'Plant',
  },
  {
    label: 'Reception templates',
    href: '/admin/templates',
    icon: IconClipboardList,
    anyOf: ['templates.manage'],
    group: 'Plant',
  },
  {
    label: 'Security audit',
    href: '/admin/audit',
    icon: IconListDetails,
    anyOf: ['audit.view_security'],
    group: 'Security',
  },
];

export const isActive = (pathname: string, href: string): boolean =>
  href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);
