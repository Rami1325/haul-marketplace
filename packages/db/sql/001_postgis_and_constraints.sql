-- ---------------------------------------------------------------------------
-- Things Drizzle's schema language cannot express.
-- Idempotent: this file re-runs on every migrate.
-- ---------------------------------------------------------------------------

-- === Generated geography columns ==========================================
--
-- The application reads and writes plain latitude/longitude doubles. The
-- indexed geography is GENERATED from them, so there is exactly one writable
-- source of truth for a position and no way for the index to disagree with the
-- numbers the code sees.
--
-- geography rather than geometry on purpose: ST_DWithin on geography takes
-- METRES and accounts for the curvature of the earth. On geometry it takes
-- degrees, and at Israeli latitudes a "5000" radius would silently mean about
-- 500km.

alter table driver_presence
  add column if not exists location geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)::geography) stored;

alter table job_stops
  add column if not exists location geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)::geography) stored;

alter table saved_addresses
  add column if not exists location geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)::geography) stored;

alter table job_location_trail
  add column if not exists location geography(Point, 4326)
  generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)::geography) stored;

-- === Spatial indexes ======================================================
--
-- The dispatch index is PARTIAL. Only online, non-busy drivers are ever
-- candidates, and on a normal evening that is a small fraction of the table —
-- so the index stays small and hot.

create index if not exists driver_presence_location_gix
  on driver_presence using gist (location)
  where is_online = true and is_busy = false;

create index if not exists job_stops_location_gix
  on job_stops using gist (location);

create index if not exists saved_addresses_location_gix
  on saved_addresses using gist (location);

-- BRIN rather than btree for the GPS trail: it is append-only and naturally
-- ordered by time, which is exactly the access pattern BRIN is for. Orders of
-- magnitude smaller than the btree equivalent on a table that grows by roughly
-- 300k rows a day at launch volume.
create index if not exists job_location_trail_time_brin
  on job_location_trail using brin (recorded_at);

-- === Money invariants =====================================================
--
-- Enforced in the Zod schema and in the posting functions already. Enforced
-- here too, because those two run in application code and this does not — and
-- a ledger that can be written unbalanced by a migration script or a console
-- session is not a ledger.

-- Amounts are integer agorot. Guard against a value large enough to suggest
-- someone passed shekels where agorot were expected, or a float crept in.
do $$ begin
  alter table ledger_entries
    add constraint ledger_entries_amount_sane
    check (amount between -100000000 and 100000000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table quotes
    add constraint quotes_total_non_negative
    check (locked_total >= 0 and driver_payout >= 0);
exception when duplicate_object then null; end $$;

-- A capture can never exceed its authorization. The rule the whole price lock
-- rests on, made structural.
do $$ begin
  alter table payment_authorizations
    add constraint payment_authorizations_capture_within_hold
    check (captured_amount >= 0 and captured_amount <= amount);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table jobs
    add constraint jobs_window_ordered
    check (window_end >= window_start);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table jobs
    add constraint jobs_crew_size_sane
    check (crew_size between 1 and 6);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table ratings
    add constraint ratings_stars_range
    check (stars between 1 and 5);
exception when duplicate_object then null; end $$;

-- === The ledger balance trigger ===========================================
--
-- The invariant: every transaction's entries sum to zero. Checked with a
-- CONSTRAINT TRIGGER deferred to commit, because entries are inserted one row
-- at a time and the sum is only meaningful once the whole transaction is in.

create or replace function assert_ledger_balances() returns trigger as $$
declare
  imbalance bigint;
begin
  select coalesce(sum(amount), 0) into imbalance
  from ledger_entries
  where transaction_id = coalesce(new.transaction_id, old.transaction_id);

  if imbalance <> 0 then
    raise exception
      'ledger transaction % does not balance: entries sum to %',
      coalesce(new.transaction_id, old.transaction_id), imbalance;
  end if;

  return null;
end;
$$ language plpgsql;

drop trigger if exists ledger_entries_balance_check on ledger_entries;
create constraint trigger ledger_entries_balance_check
  after insert or update or delete on ledger_entries
  deferrable initially deferred
  for each row execute function assert_ledger_balances();

-- === Full-text-ish search on catalog-free columns =========================
--
-- Hebrew has no stemmer in stock Postgres, so trigram similarity does the work
-- for address and name search. Cheap, language-agnostic, and it tolerates the
-- spelling variation Hebrew free text is full of.

create index if not exists saved_addresses_formatted_trgm
  on saved_addresses using gin (formatted gin_trgm_ops);

create index if not exists job_stops_formatted_trgm
  on job_stops using gin (formatted gin_trgm_ops);
