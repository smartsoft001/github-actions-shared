'use strict';
// Emits reviewable SQL only; no connection, secret or execution path.
const fs=require('node:fs');
const path=require('node:path');
const DATABASE='ai_os_development_observer';
const OWNER='development_observer_owner';
const INGRESS='development_observer_ingress';
const WATCH='development_observer_watch';

function build() {
  return `BEGIN;
DO $guard$
BEGIN
  IF current_database() <> '${DATABASE}' THEN
    RAISE EXCEPTION 'Dedicated observer database required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') THEN
    RAISE EXCEPTION 'Fresh empty observer schema required; no automatic migration/reset';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('${OWNER}','${INGRESS}','${WATCH}')) THEN
    RAISE EXCEPTION 'Observer role already exists; explicit review required';
  END IF;
END
$guard$;
CREATE ROLE ${OWNER} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${INGRESS} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE ${WATCH} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
ALTER DATABASE ${DATABASE} OWNER TO ${OWNER};
REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC;
ALTER SCHEMA public OWNER TO ${OWNER};
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SET LOCAL ROLE ${OWNER};
SET LOCAL search_path=public,pg_catalog;
${fs.readFileSync(path.join(__dirname,'external-observer.sql'),'utf8')}
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
RESET ROLE;
GRANT CONNECT ON DATABASE ${DATABASE} TO ${INGRESS},${WATCH};
GRANT USAGE ON SCHEMA public TO ${INGRESS},${WATCH};
GRANT SELECT ON development_observer_registry TO ${INGRESS},${WATCH};
GRANT SELECT,INSERT,UPDATE ON development_observer_latest TO ${INGRESS};
GRANT SELECT ON development_observer_latest,development_observer_notices TO ${WATCH};
GRANT INSERT(notice_id,monitor_id,status),UPDATE(status,request_id) ON development_observer_notices TO ${WATCH};
ALTER ROLE ${INGRESS} IN DATABASE ${DATABASE} SET search_path=pg_catalog,public;
ALTER ROLE ${WATCH} IN DATABASE ${DATABASE} SET search_path=pg_catalog,public;
ALTER ROLE ${INGRESS} IN DATABASE ${DATABASE} SET statement_timeout='3s';
ALTER ROLE ${WATCH} IN DATABASE ${DATABASE} SET statement_timeout='3s';
ALTER ROLE ${INGRESS} IN DATABASE ${DATABASE} SET lock_timeout='3s';
ALTER ROLE ${WATCH} IN DATABASE ${DATABASE} SET lock_timeout='3s';
ALTER ROLE ${INGRESS} IN DATABASE ${DATABASE} SET idle_in_transaction_session_timeout='5s';
ALTER ROLE ${WATCH} IN DATABASE ${DATABASE} SET idle_in_transaction_session_timeout='5s';
COMMIT;
`;
}
function readiness(role) {
  if(![INGRESS,WATCH].includes(role))throw Error('Only dedicated observer roles allowed');
  const common=`current_database()='${DATABASE}' AS database_ok,
 current_user='${role}' AS role_ok,
 NOT (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) AS unprivileged,
 NOT pg_has_role(current_user,'${OWNER}','MEMBER') AS not_owner_member,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS no_role_memberships,
 NOT has_database_privilege(current_database(),'CREATE') AS cannot_create_schema,
 NOT has_database_privilege(current_database(),'TEMP') AS cannot_create_temp,
 has_table_privilege('public.development_observer_registry','SELECT') AS registry_read,
 (NOT has_table_privilege('public.development_observer_registry','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.development_observer_registry'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege(attrelid,attname,'INSERT,UPDATE'))) AS registry_immutable,
 has_table_privilege('public.development_observer_latest','SELECT') AS heartbeat_read`;
  const specialized=role===INGRESS?`,
 (has_table_privilege('public.development_observer_latest','INSERT') AND has_table_privilege('public.development_observer_latest','UPDATE')) AS heartbeat_write,
 NOT has_table_privilege('public.development_observer_latest','DELETE') AS cannot_delete_heartbeat,
 NOT has_table_privilege('public.development_observer_notices','SELECT') AS no_notice_access`
  :`,
 (NOT has_table_privilege('public.development_observer_latest','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.development_observer_latest'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege(attrelid,attname,'INSERT,UPDATE'))) AS heartbeat_immutable,
 has_table_privilege('public.development_observer_notices','SELECT') AS notice_read,
 has_column_privilege('public.development_observer_notices','notice_id','INSERT') AS notice_insert,
 has_column_privilege('public.development_observer_notices','status','UPDATE') AS receipt_update,
 NOT has_table_privilege('public.development_observer_notices','DELETE') AS cannot_delete_notice,
 NOT has_column_privilege('public.development_observer_notices','attempted_at','INSERT') AS cannot_forge_notice_time,
 NOT has_column_privilege('public.development_observer_notices','attempted_at','UPDATE') AS cannot_backdate_notice`;
  return 'SELECT '+common+specialized+';';
}
if(require.main===module) {
  if(process.argv.length!==2)throw Error('This SQL generator accepts no host, credentials or apply option');
  process.stdout.write(build());
}
module.exports={build,readiness,DATABASE,OWNER,INGRESS,WATCH};
