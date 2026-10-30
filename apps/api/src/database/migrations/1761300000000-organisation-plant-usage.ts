import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plant usage for the internal portal (IAD-004): one total per organisation.
 * Like the user and storage counts, staff get a number, never the records.
 */
const UP = /* sql */ `
create function corecheck.organisation_plant_counts()
  returns table (org_id uuid, plants integer)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select p.org_id, count(*)::integer
      from corecheck.plants p
     where p.archived_at is null
     group by p.org_id
  $$;
revoke all on function corecheck.organisation_plant_counts() from public;
grant execute on function corecheck.organisation_plant_counts() to corecheck_platform;
`;

const DOWN = /* sql */ `
drop function corecheck.organisation_plant_counts();
`;

export class OrganisationPlantUsage1761300000000 implements MigrationInterface {
  name = 'OrganisationPlantUsage1761300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}
