-- ProtoCarries · Cron job para invocar sync-characters cada 30 minutos.
-- Correr DESPUÉS de deployar la Edge Function (ver README de supabase/functions/sync-characters).
--
-- Reemplazá:
--   <PROJECT_REF>          -> el ref de tu proyecto (ej. hjatxlvqytgkizcaopce)
--   <SERVICE_ROLE_KEY>     -> Project Settings > API > service_role key (NO la publishable/anon)
--
-- Esta key queda guardada en el schema de tu propio proyecto Supabase (no en el HTML,
-- no en GitHub) — solo vos y quien tenga acceso al SQL editor la ve.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-characters-every-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-characters',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para revisar que el cron corre: select * from cron.job; y select * from cron.job_run_details order by start_time desc limit 10;
-- Para borrarlo si hace falta: select cron.unschedule('sync-characters-every-30min');
