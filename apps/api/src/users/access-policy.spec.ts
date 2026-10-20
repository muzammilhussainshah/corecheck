import {
  getStandardRole,
  type PermissionCode,
  type StandardRoleKey,
} from '@corecheck/shared';
import {
  type Actor,
  canAdminister,
  canAssignRole,
  canAssignSites,
  canViewUser,
  capabilitiesFor,
  type TargetUser,
} from './access-policy.js';

const LEEDS = 'site-leeds';
const YORK = 'site-york';
const LIFTING = 'team-lifting';

const actor = (key: StandardRoleKey, overrides: Partial<Actor> = {}): Actor => {
  const role = getStandardRole(key);
  return {
    userId: `actor-${key}`,
    standardKey: key,
    orgWide: role.orgWideScope,
    permissions: new Set(role.permissions),
    siteIds: [LEEDS],
    teamIds: [LIFTING],
    ...overrides,
  };
};

const target = (overrides: Partial<TargetUser> = {}): TargetUser => ({
  id: 'target',
  status: 'active',
  privileged: false,
  siteIds: [LEEDS],
  teamIds: [],
  ...overrides,
});

describe('access policy', () => {
  describe('canViewUser', () => {
    it('lets Admins see everyone', () => {
      expect(
        canViewUser(
          actor('admin', { siteIds: [] }),
          target({ siteIds: [YORK] }),
        ),
      ).toBe(true);
    });

    it('limits Managers to shared sites', () => {
      expect(canViewUser(actor('manager'), target())).toBe(true);
      expect(canViewUser(actor('manager'), target({ siteIds: [YORK] }))).toBe(
        false,
      );
      expect(canViewUser(actor('manager'), target({ siteIds: [] }))).toBe(
        false,
      );
    });

    it('limits Supervisors to shared teams, whatever the site', () => {
      expect(
        canViewUser(
          actor('supervisor'),
          target({ teamIds: [LIFTING], siteIds: [YORK] }),
        ),
      ).toBe(true);
      expect(canViewUser(actor('supervisor'), target({ teamIds: [] }))).toBe(
        false,
      );
    });

    it('hides other users from roles without users.view, but never the user themself', () => {
      expect(canViewUser(actor('operative'), target())).toBe(false);
      expect(
        canViewUser(actor('operative'), target({ id: 'actor-operative' })),
      ).toBe(true);
    });
  });

  describe('canAdminister', () => {
    const manage: PermissionCode = 'users.manage';

    it('lets Admins act on anyone except themselves', () => {
      const admin = actor('admin');
      expect(
        canAdminister(
          admin,
          target({ privileged: true, siteIds: [YORK] }),
          manage,
        ),
      ).toBe(true);
      expect(canAdminister(admin, target({ id: admin.userId }), manage)).toBe(
        false,
      );
    });

    it('lets Managers act only on non-privileged users wholly inside their sites (ROL-005)', () => {
      const manager = actor('manager');
      expect(canAdminister(manager, target(), manage)).toBe(true);
      expect(canAdminister(manager, target({ privileged: true }), manage)).toBe(
        false,
      );
      expect(
        canAdminister(manager, target({ siteIds: [LEEDS, YORK] }), manage),
      ).toBe(false);
      expect(canAdminister(manager, target({ siteIds: [] }), manage)).toBe(
        false,
      );
    });

    it('requires the permission itself', () => {
      expect(canAdminister(actor('supervisor'), target(), manage)).toBe(false);
    });

    it('lets an organisation-wide custom role act on non-privileged users anywhere', () => {
      const custom = actor('manager', {
        standardKey: null,
        orgWide: true,
        siteIds: [],
      });
      expect(canAdminister(custom, target({ siteIds: [YORK] }), manage)).toBe(
        true,
      );
      expect(canAdminister(custom, target({ privileged: true }), manage)).toBe(
        false,
      );
    });
  });

  it('only Admins assign privileged roles, and nobody assigns archived ones', () => {
    expect(
      canAssignRole(actor('admin'), { privileged: true, archived: false }),
    ).toBe(true);
    expect(
      canAssignRole(actor('manager'), { privileged: true, archived: false }),
    ).toBe(false);
    expect(
      canAssignRole(actor('manager'), { privileged: false, archived: false }),
    ).toBe(true);
    expect(
      canAssignRole(actor('admin'), { privileged: false, archived: true }),
    ).toBe(false);
  });

  it('only lets non-organisation-wide actors assign their own sites (SCP-004)', () => {
    expect(canAssignSites(actor('manager'), [LEEDS])).toBe(true);
    expect(canAssignSites(actor('manager'), [LEEDS, YORK])).toBe(false);
    expect(canAssignSites(actor('admin', { siteIds: [] }), [YORK])).toBe(true);
  });

  it('derives the capabilities the UI shows', () => {
    expect(
      capabilitiesFor(actor('manager'), target({ status: 'locked' })),
    ).toEqual({
      canEdit: true,
      canChangeRole: true,
      canAssignScope: true,
      canResetPin: true,
      canUnlock: true,
      canDeactivate: true,
      canReactivate: false,
    });
    expect(
      capabilitiesFor(actor('manager'), target({ status: 'inactive' })),
    ).toMatchObject({
      canUnlock: false,
      canDeactivate: false,
      canReactivate: true,
    });
  });
});
