-- Customer self-service: local credentials, contact phone and UI preferences.
--
-- password_hash is set only for accounts registered through the public signup
-- endpoint. Supabase-verified and demo identities keep it null; the presence of
-- a hash is what makes an email/password login possible for that profile.
alter table dealflow.profiles
    add column password_hash text,
    add column phone         text,
    add column preferences   jsonb not null default '{}'::jsonb;
