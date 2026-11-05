-- Samvaad Charades schema (PostgreSQL 16; also runs on PGlite for local development).
-- Round results are computed from attempts, never stored (CLAUDE.md §6).

CREATE TABLE IF NOT EXISTS offices (
  id text PRIMARY KEY, name_en text NOT NULL, name_hi text, type text NOT NULL, city text NOT NULL,
  state text NOT NULL, pincode text, address text NOT NULL, address_composed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, mobile text NOT NULL,
  office_id text NOT NULL REFERENCES offices(id), office_address text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(), registration_credits numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary_terms (
  id text PRIMARY KEY, en text NOT NULL, en_norm text NOT NULL UNIQUE, hi text NOT NULL,
  accepted_variants text[] NOT NULL DEFAULT '{}', avoid_forms text[] NOT NULL DEFAULT '{}',
  flags text[] NOT NULL DEFAULT '{}', override jsonb
);
CREATE INDEX IF NOT EXISTS glossary_hi_idx ON glossary_terms (hi);

CREATE TABLE IF NOT EXISTS pages (
  id text PRIMARY KEY, round_key text NOT NULL, label text NOT NULL, printed_page_no text,
  sector text NOT NULL DEFAULT '',            -- stored, NEVER sent to the client
  source jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft', active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1, sample boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_parts (
  id text NOT NULL, page_id text NOT NULL REFERENCES pages(id) ON DELETE CASCADE, ord int NOT NULL,
  type text NOT NULL, tick_group text, editable boolean NOT NULL, layout jsonb,
  fields jsonb NOT NULL,                       -- [{key,en,hiReference,draft,locked,numeric}]
  en_sentences jsonb, reference_verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (page_id, id)
);

CREATE TABLE IF NOT EXISTS planted_slips (
  id serial PRIMARY KEY, page_id text NOT NULL REFERENCES pages(id) ON DELETE CASCADE, part_id text NOT NULL,
  kind text NOT NULL, wrong_text text NOT NULL, en_term text, fix_hint text NOT NULL
);

CREATE TABLE IF NOT EXISTS page_terms (
  page_id text NOT NULL REFERENCES pages(id) ON DELETE CASCADE, ord int NOT NULL,
  en text NOT NULL, hi text NOT NULL, variants text[] NOT NULL DEFAULT '{}', avoid text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (page_id, en)
);

CREATE TABLE IF NOT EXISTS attempts (
  id text PRIMARY KEY, player_id text NOT NULL REFERENCES players(id), round_key text NOT NULL, chance_no int NOT NULL,
  page_id text NOT NULL REFERENCES pages(id), started_at timestamptz NOT NULL, deadline_at timestamptz NOT NULL,
  last_saved_at timestamptz, submitted_at timestamptz, auto_submitted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active', answers jsonb NOT NULL, answers_version int NOT NULL DEFAULT 0,
  active_client_id text, left_page_count int NOT NULL DEFAULT 0, paste_blocked_count int NOT NULL DEFAULT 0,
  measures jsonb, score int, tip jsonb, result jsonb, chat_count int NOT NULL DEFAULT 0,
  UNIQUE (player_id, round_key, chance_no)
);
-- one active attempt per player at a time
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_active ON attempts (player_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS attempt_events (
  id serial PRIMARY KEY, attempt_id text NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  type text NOT NULL, at timestamptz NOT NULL DEFAULT now(), meta jsonb
);

CREATE TABLE IF NOT EXISTS sahayika_lines (
  id text PRIMARY KEY, section text NOT NULL, part text NOT NULL, moment text NOT NULL, spoken boolean NOT NULL,
  en text NOT NULL, hi text NOT NULL, audio_path text, edited_by text, edited_at timestamptz
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id serial PRIMARY KEY, player_id text, attempt_id text, question text NOT NULL, en text NOT NULL, hi text NOT NULL,
  source text NOT NULL, blocked boolean NOT NULL DEFAULT false, at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS xlit_stats (day date NOT NULL, accepted_index int NOT NULL, count int NOT NULL DEFAULT 0, PRIMARY KEY (day, accepted_index));

CREATE TABLE IF NOT EXISTS otp_challenges (email text PRIMARY KEY, code_hash text NOT NULL, expires_at timestamptz NOT NULL, tries int NOT NULL DEFAULT 0, sent_count int NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS admin_users (email text PRIMARY KEY, role text NOT NULL CHECK (role IN ('manager','viewer')));

CREATE TABLE IF NOT EXISTS config_overrides (key text PRIMARY KEY, value jsonb NOT NULL, by text NOT NULL, at timestamptz NOT NULL DEFAULT now());

-- iteration 3: report scope (Union / state) for office mapping, page numbers inside multi-page bundles, play sessions
ALTER TABLE pages ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'union';
ALTER TABLE page_parts ADD COLUMN IF NOT EXISTS page_no int;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS session_id text;

CREATE TABLE IF NOT EXISTS audit_logs (id serial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, target text NOT NULL, at timestamptz NOT NULL DEFAULT now(), meta jsonb);

-- Anuvaad glossary sectors (sector widens, never narrows); null = general entry
ALTER TABLE glossary_terms ADD COLUMN IF NOT EXISTS sector text;

-- scoring v2: scores carry one decimal (stored integer scores stay as they are)
DO $$ BEGIN IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'attempts' AND column_name = 'score' AND table_schema = current_schema()) = 'integer' THEN ALTER TABLE attempts ALTER COLUMN score TYPE double precision; END IF; END $$;
