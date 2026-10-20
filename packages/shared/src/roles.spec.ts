import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, PRIVILEGED_PERMISSIONS } from './permissions.js';
import {
  isPrivilegedRole,
  STANDARD_ROLES,
  type StandardRoleKey,
} from './roles.js';

/**
 * FRD Appendix C restated independently, one line per row:
 * Operative, Technician, Supervisor, Manager, Admin.
 */
const APPENDIX_C: Record<string, string> = {
  'plant.view': 'XXXXX',
  'plant.create': 'X--XX',
  'plant.edit': '---XX',
  'plant.manage_identifiers': '---XX',
  'plant.assign': '--XXX',
  'plant.archive': '---XX',
  'plant.qr': '--XXX',
  'plant.import': '---XX',
  'plant.export': '--XXX',
  'reception.complete': 'XXXXX',
  'reception.assign_template': '--XXX',
  'reception.approve': '--XXX',
  'plant_status.restrict': '--XXX',
  'plant_status.return_to_service': '--XXX',
  'plant_status.override': '---XX',
  'documents.view': 'XXXXX',
  'documents.upload': 'XXXXX',
  'documents.manage': '--XXX',
  'documents.verify': '--XXX',
  'documents.configure': '----X',
  'meters.record': 'XXXXX',
  'meters.correct': '--XXX',
  'meters.configure': '----X',
  'templates.view': '--XXX',
  'templates.manage': '----X',
  'templates.configure_questions': '----X',
  'schedules.view': 'XXXXX',
  'schedules.manage_rules': '----X',
  'schedules.assign': '--XXX',
  'schedules.reschedule': '--XXX',
  'schedules.manage_overdue': '--XXX',
  'checks.view': 'XXXXX',
  'checks.perform': 'XXXXX',
  'checks.review': '--XXX',
  'checks.reopen': '--XXX',
  'checks.edit_submitted': '---XX',
  'checks.cancel': '--XXX',
  'checks.export': 'XXXXX',
  'defects.view': 'XXXXX',
  'defects.assign': '--XXX',
  'defects.start': '-XXXX',
  'defects.record_work': '-XXXX',
  'defects.verify': '-XXXX',
  'defects.approve_verification': '--XXX',
  'defects.close': '-XXXX',
  'defects.reopen': '---XX',
  'defects.override_restriction': '---XX',
  'users.view': '--XXX',
  'users.manage': '---XX',
  'users.reset_pin': '---XX',
  'users.assign_scope': '---XX',
  'roles.view': '---XX',
  'roles.manage': '----X',
  'org_structure.view': 'XXXXX',
  'org_structure.manage': '----X',
  'plant_config.manage': '----X',
  'org_settings.manage': '----X',
  'notifications.view_own': 'XXXXX',
  'notifications.configure': '----X',
  'reports.view': '--XXX',
  'reports.export': '--XXX',
  'audit.view_operational': '---XX',
  'audit.view_security': '----X',
  'cold_storage.retrieve': '---XX',
};

const COLUMNS: StandardRoleKey[] = [
  'operative',
  'technician',
  'supervisor',
  'manager',
  'admin',
];

describe('standard roles', () => {
  it('cover exactly the permission catalogue', () => {
    expect(Object.keys(APPENDIX_C).sort()).toEqual(
      [...PERMISSION_CODES].sort(),
    );
  });

  it.each(COLUMNS.map((key, column) => [key, column] as const))(
    '%s holds exactly its Appendix C permissions',
    (key, column) => {
      const role = STANDARD_ROLES.find((candidate) => candidate.key === key)!;
      const expected = Object.entries(APPENDIX_C)
        .filter(([, marks]) => marks[column] === 'X')
        .map(([code]) => code)
        .sort();
      expect([...new Set(role.permissions)].sort()).toEqual(expected);
    },
  );

  it('give only Admin organisation-wide scope', () => {
    expect(
      STANDARD_ROLES.filter((role) => role.orgWideScope).map(
        (role) => role.key,
      ),
    ).toEqual(['admin']);
  });

  it('mark Admin, Manager and user-managing custom roles as privileged (ROL-004)', () => {
    const privileged = STANDARD_ROLES.filter((role) =>
      isPrivilegedRole({
        standardKey: role.key,
        permissions: role.permissions,
      }),
    ).map((role) => role.key);
    expect(privileged).toEqual(['manager', 'admin']);

    expect(
      isPrivilegedRole({ standardKey: null, permissions: ['plant.view'] }),
    ).toBe(false);
    for (const permission of PRIVILEGED_PERMISSIONS) {
      expect(
        isPrivilegedRole({ standardKey: null, permissions: [permission] }),
      ).toBe(true);
    }
  });
});
