import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import type {
  ClientType,
  OrganisationStatus,
  PocCheckStatus,
  PocQuestionKey,
  StaffRole,
  StaffStatus,
  StandardRoleKey,
  UserStatus,
} from '@corecheck/shared';

/**
 * Entity mappings for the tables created by the migrations. Relations are
 * resolved in queries rather than declared here: child tables reference their
 * parents by composite (id, org_id) keys, which the database enforces.
 * Column types are spelled out because the API is compiled without relying on
 * reflected design types.
 */

const SCHEMA = 'corecheck';

/** A jsonb column holding an object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = Record<string, any>;

@Entity({ schema: SCHEMA, name: 'organisations' })
export class OrganisationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text') name!: string;
  @Column('text') industry!: string;
  @Column('text') contactName!: string;
  @Column('text') contactEmail!: string;
  @Column('text') contactPhone!: string;
  @Column('text') address!: string;
  @Column('text') country!: string;
  @Column('text') timeZone!: string;
  @Column('integer') seatLimit!: number;
  @Column('date') startsOn!: string;
  @Column('date') expiresOn!: string;
  @Column('text') status!: OrganisationStatus;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'roles' })
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('text', { nullable: true }) standardKey!: StandardRoleKey | null;
  @Column('text') name!: string;
  @Column('text') description!: string;
  @Column('boolean') orgWideScope!: boolean;
  @Column('timestamptz', { nullable: true }) archivedAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'role_permissions' })
export class RolePermissionEntity {
  @PrimaryColumn('uuid') roleId!: string;
  @PrimaryColumn('text') permission!: string;
  @Column('uuid') orgId!: string;
}

@Entity({ schema: SCHEMA, name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('text') firstName!: string;
  @Column('text') lastName!: string;
  @Column('text') username!: string;
  @Column('text', { nullable: true }) email!: string | null;
  @Column('uuid') roleId!: string;
  @Column('text') status!: UserStatus;
  @Column('text') pinHash!: string;
  @Column('boolean') mustChangePin!: boolean;
  @Column('timestamptz', { nullable: true }) tempPinExpiresAt!: Date | null;
  @Column('integer') failedPinAttempts!: number;
  @Column('timestamptz', { nullable: true }) lockedAt!: Date | null;
  @Column('timestamptz', { nullable: true }) lastLoginAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'user_sessions' })
export class UserSessionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('uuid') userId!: string;
  @Column('text') tokenHash!: string;
  @Column('text') client!: ClientType;
  @Column('text', { nullable: true }) ip!: string | null;
  @Column('text', { nullable: true }) userAgent!: string | null;
  @Column('timestamptz') createdAt!: Date;
  @Column('timestamptz') lastSeenAt!: Date;
  @Column('timestamptz') expiresAt!: Date;
  @Column('integer') idleTimeoutSeconds!: number;
  @Column('timestamptz', { nullable: true }) revokedAt!: Date | null;
  @Column('text', { nullable: true }) revokeReason!: string | null;
}

@Entity({ schema: SCHEMA, name: 'sites' })
export class SiteEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('text') name!: string;
  @Column('text', { nullable: true }) code!: string | null;
  @Column('text', { nullable: true }) address!: string | null;
  @Column('timestamptz', { nullable: true }) archivedAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'site_areas' })
export class AreaEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('uuid') siteId!: string;
  @Column('text') name!: string;
  @Column('timestamptz', { nullable: true }) archivedAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'teams' })
export class TeamEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('text') name!: string;
  @Column('text', { nullable: true }) description!: string | null;
  @Column('timestamptz', { nullable: true }) archivedAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'disciplines' })
export class DisciplineEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('text') name!: string;
  @Column('timestamptz', { nullable: true }) archivedAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'user_sites' })
export class UserSiteEntity {
  @PrimaryColumn('uuid') userId!: string;
  @PrimaryColumn('uuid') siteId!: string;
  @Column('uuid') orgId!: string;
}

@Entity({ schema: SCHEMA, name: 'user_teams' })
export class UserTeamEntity {
  @PrimaryColumn('uuid') userId!: string;
  @PrimaryColumn('uuid') teamId!: string;
  @Column('uuid') orgId!: string;
}

@Entity({ schema: SCHEMA, name: 'user_disciplines' })
export class UserDisciplineEntity {
  @PrimaryColumn('uuid') userId!: string;
  @PrimaryColumn('uuid') disciplineId!: string;
  @Column('uuid') orgId!: string;
}

@Entity({ schema: SCHEMA, name: 'platform_staff' })
export class PlatformStaffEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('text') email!: string;
  @Column('text') name!: string;
  @Column('text') staffRole!: StaffRole;
  @Column('text') passwordHash!: string;
  @Column('boolean') mustChangePassword!: boolean;
  @Column('text', { nullable: true }) mfaSecretEncrypted!: string | null;
  @Column('text', { nullable: true }) mfaPendingSecretEncrypted!: string | null;
  @Column('timestamptz', { nullable: true }) mfaEnabledAt!: Date | null;
  @Column('text') status!: StaffStatus;
  @Column('integer') failedLoginAttempts!: number;
  @Column('timestamptz', { nullable: true }) lockedAt!: Date | null;
  @Column('timestamptz', { nullable: true }) lastLoginAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'staff_sessions' })
export class StaffSessionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') staffId!: string;
  @Column('text') tokenHash!: string;
  @Column('timestamptz', { nullable: true }) mfaVerifiedAt!: Date | null;
  @Column('text', { nullable: true }) ip!: string | null;
  @Column('text', { nullable: true }) userAgent!: string | null;
  @Column('timestamptz') createdAt!: Date;
  @Column('timestamptz') lastSeenAt!: Date;
  @Column('timestamptz') expiresAt!: Date;
  @Column('integer') idleTimeoutSeconds!: number;
  @Column('timestamptz', { nullable: true }) revokedAt!: Date | null;
  @Column('text', { nullable: true }) revokeReason!: string | null;
}

@Entity({ schema: SCHEMA, name: 'audit_events' })
export class AuditEventEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;
  @Column({ type: 'timestamptz', insert: false, update: false })
  occurredAt!: Date;
  @Column('text') scope!: 'tenant' | 'platform';
  @Column('uuid', { nullable: true }) orgId!: string | null;
  @Column('text') actorType!: 'user' | 'staff' | 'system';
  @Column('uuid', { nullable: true }) actorId!: string | null;
  @Column('text', { nullable: true }) actorName!: string | null;
  @Column('text') action!: string;
  @Column('text', { nullable: true }) entityType!: string | null;
  @Column('text', { nullable: true }) entityId!: string | null;
  @Column('text') summary!: string;
  @Column('jsonb', { nullable: true }) before!: JsonObject | null;
  @Column('jsonb', { nullable: true }) after!: JsonObject | null;
  @Column('jsonb') metadata!: JsonObject;
}

@Entity({ schema: SCHEMA, name: 'poc_checks' })
export class PocCheckEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('uuid') siteId!: string;
  @Column('text') title!: string;
  @Column('text') plantLabel!: string;
  @Column('text') status!: PocCheckStatus;
  @Column('uuid', { nullable: true }) submittedBy!: string | null;
  @Column('timestamptz', { nullable: true }) submittedAt!: Date | null;
  @Column('timestamptz', { nullable: true }) submittedOnDeviceAt!: Date | null;
  @Column({ type: 'timestamptz', insert: false, update: false })
  createdAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  updatedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'poc_answers' })
export class PocAnswerEntity {
  @PrimaryColumn('uuid') checkId!: string;
  @PrimaryColumn('text') questionKey!: PocQuestionKey;
  @Column('uuid') orgId!: string;
  @Column('text') value!: string;
  @Column('uuid') answeredBy!: string;
  @Column('timestamptz') answeredAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  receivedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'poc_evidence' })
export class PocEvidenceEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('uuid') checkId!: string;
  @Column('text') questionKey!: PocQuestionKey;
  @Column('text') storagePath!: string;
  @Column('text') contentType!: string;
  @Column('integer') sizeBytes!: number;
  @Column('uuid') uploadedBy!: string;
  @Column('timestamptz') capturedAt!: Date;
  @Column({ type: 'timestamptz', insert: false, update: false })
  receivedAt!: Date;
}

@Entity({ schema: SCHEMA, name: 'poc_mutations' })
export class PocMutationEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') orgId!: string;
  @Column('uuid') userId!: string;
  @Column('jsonb') result!: JsonObject;
  @Column({ type: 'timestamptz', insert: false, update: false })
  receivedAt!: Date;
}

export const ENTITIES = [
  OrganisationEntity,
  RoleEntity,
  RolePermissionEntity,
  UserEntity,
  UserSessionEntity,
  SiteEntity,
  AreaEntity,
  TeamEntity,
  DisciplineEntity,
  UserSiteEntity,
  UserTeamEntity,
  UserDisciplineEntity,
  PlatformStaffEntity,
  StaffSessionEntity,
  AuditEventEntity,
  PocCheckEntity,
  PocAnswerEntity,
  PocEvidenceEntity,
  PocMutationEntity,
];
