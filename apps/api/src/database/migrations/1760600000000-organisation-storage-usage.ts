import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Storage usage per organisation for the internal portal (IAD-004). Staff
 * hold no grants on customer tables, so they see only these totals through a
 * definer function, never the files or records themselves. Later file types
 * (documents, check evidence) are added to this function as they arrive.
 */
const UP = /* sql */ `
create function corecheck.organisation_storage_usage()
  returns table (org_id uuid, files integer, bytes bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select e.org_id, count(*)::integer, coalesce(sum(e.size_bytes), 0)::bigint
      from corecheck.poc_evidence e
     group by e.org_id
  $$;
revoke all on function corecheck.organisation_storage_usage() from public;
grant execute on function corecheck.organisation_storage_usage() to corecheck_platform;
`;

const DOWN = /* sql */ `
drop function corecheck.organisation_storage_usage();
`;

export class OrganisationStorageUsage1760600000000 implements MigrationInterface {
  name = 'OrganisationStorageUsage1760600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}
