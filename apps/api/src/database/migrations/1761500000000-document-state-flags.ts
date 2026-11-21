import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Milestone 2 bug 6: a document's single state cannot say both "awaiting
 * verification" and "expires soon", so one hid the other. The view keeps its
 * state and gains the two facts beside it:
 *
 * - verification: the current version's, so an unverified document stays
 *   findable as Awaiting Verification even once it has expired;
 * - expires_soon: within the type's warning days and not yet expired, so
 *   expiry nearness shows as a warning on an unverified document too.
 *
 * Columns are only appended, so plant_requirement_states and the grants on
 * the view stay as they are.
 */
const STATES_VIEW = (extra: string) => /* sql */ `
create or replace view corecheck.plant_document_states with (security_invoker = true) as
select d.org_id, d.id as document_id, d.plant_id, d.document_type_id,
       v.id as version_id, v.expires_on,
       case
         when d.archived_at is not null then 'archived'
         when v.verification = 'rejected' then 'rejected'
         when t.has_expiry and v.expires_on < today.value then 'expired'
         when v.verification = 'awaiting' then 'awaiting_verification'
         when t.has_expiry and v.expires_on <= today.value + t.warning_days
           then 'approaching_expiry'
         else 'valid'
       end as state${extra}
  from corecheck.plant_documents d
  join corecheck.plant_document_versions v on v.id = d.current_version_id
  join corecheck.document_types t on t.id = d.document_type_id
  join corecheck.organisations o on o.id = d.org_id
  cross join lateral (select (now() at time zone o.time_zone)::date as value) today;
`;

const UP = STATES_VIEW(`,
       v.verification,
       (t.has_expiry
         and v.expires_on >= today.value
         and v.expires_on <= today.value + t.warning_days) as expires_soon`);

// A view cannot lose columns in place: rebuild both views as they were.
const DOWN = /* sql */ `
drop view corecheck.plant_requirement_states;
drop view corecheck.plant_document_states;
${STATES_VIEW('')}
create view corecheck.plant_requirement_states with (security_invoker = true) as
select p.org_id, p.id as plant_id, r.document_type_id, t.name as document_type_name,
       coalesce(best.state, 'missing') as state
  from corecheck.plants p
  join corecheck.plant_type_required_documents r on r.plant_type_id = p.plant_type_id
  join corecheck.document_types t on t.id = r.document_type_id and t.archived_at is null
  left join lateral (
    select s.state
      from corecheck.plant_document_states s
     where s.plant_id = p.id
       and s.document_type_id = r.document_type_id
       and s.state <> 'archived'
     order by case s.state
                when 'valid' then 1
                when 'approaching_expiry' then 2
                when 'awaiting_verification' then 3
                when 'rejected' then 4
                else 5
              end
     limit 1
  ) best on true;
grant select on
  corecheck.plant_document_states, corecheck.plant_requirement_states
  to corecheck_app;
`;

export class DocumentStateFlags1761500000000 implements MigrationInterface {
  name = 'DocumentStateFlags1761500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(UP);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DOWN);
  }
}
