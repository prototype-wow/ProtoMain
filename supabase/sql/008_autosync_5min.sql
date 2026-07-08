-- ProtoCarries · Refresco automático cada 5 min con toggle on/off desde el HTML.
-- Corré esto en el SQL Editor. Reemplazá <SERVICE_ROLE_KEY> por tu secret key
-- (la misma que usaste en 002_cron.sql).

-- 1) Flag para prender/apagar el auto-sync desde la pestaña Usuarios (admin).
alter table app_settings add column if not exists auto_sync boolean not null default true;

-- 2) Reprogramar el cron: de 30 min a 5 min, y marcar la llamada como "cron"
--    (así el toggle auto_sync solo frena al automático, no al botón manual).
select cron.unschedule('sync-characters-every-30min');

select cron.schedule(
  'sync-characters-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://hjatxlvqytgkizcaopce.supabase.co/functions/v1/sync-characters',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{"source":"cron"}'::jsonb
  );
  $$
);

-- Verificar: select jobname, schedule, active from cron.job;
