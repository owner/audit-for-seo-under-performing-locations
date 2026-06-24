-- Migration: SEO Audit Tables
-- Add this file as migrations/0002_seo_audit_tables.sql in your repo

-- ─── Locations ──────────────────────────────────────────────────────────────
-- One row per client location. Populate by syncing from Snowflake.
CREATE TABLE IF NOT EXISTS locations (
  location_id                     TEXT PRIMARY KEY,
  brand_name                      TEXT,
  website_url                     TEXT,
  primary_market                  TEXT,
  csm_name                        TEXT,
  seo_owner                       TEXT,
  date_opened                     TEXT,         -- ISO date string, e.g. '2026-01-23'
  yext_managed                    INTEGER DEFAULT 0,  -- 1 = yes, 0 = no
  launch_date                     TEXT,
  gbp_listing_url                 TEXT,

  -- GBP engagement metrics (30-day window)
  gbp_profile_views_30d           INTEGER DEFAULT 0,
  gbp_calls_30d                   INTEGER DEFAULT 0,
  gbp_directions_30d              INTEGER DEFAULT 0,

  -- GBP engagement metrics (90-day window, for trend calcs)
  gbp_profile_views_90d           INTEGER DEFAULT 0,
  gbp_calls_90d                   INTEGER DEFAULT 0,

  -- Google reviews
  avg_star_rating                 REAL,
  review_count                    INTEGER DEFAULT 0,

  -- Organic traffic
  organic_sessions_30d            INTEGER DEFAULT 0,
  organic_sessions_prior_30d      INTEGER DEFAULT 0,  -- previous 30d window for trend

  -- Local pack
  local_pack_impressions_30d      INTEGER DEFAULT 0,
  local_pack_impressions_prior_30d INTEGER DEFAULT 0,

  -- Rankings / indexing
  indexed_pages                   INTEGER DEFAULT 0,
  avg_local_rank                  REAL,
  yext_sync_status                TEXT DEFAULT 'unknown',

  -- Audit metadata
  synced_at                       TEXT    -- ISO timestamp of last Snowflake sync
);

-- ─── Reviews ────────────────────────────────────────────────────────────────
-- One row per Google review. Used to compute response rate and review velocity.
CREATE TABLE IF NOT EXISTS reviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id     TEXT NOT NULL REFERENCES locations(location_id),
  review_id       TEXT UNIQUE,             -- GBP review ID (optional, prevents duplicates)
  star_rating     INTEGER,                 -- 1–5
  comment         TEXT,
  owner_response  TEXT,                    -- NULL = not responded
  created_at      TEXT NOT NULL,           -- ISO date string, e.g. '2026-05-01'
  synced_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_location_id ON reviews(location_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at  ON reviews(created_at);

-- ─── Yext Listings ──────────────────────────────────────────────────────────
-- One row per publisher per location. Used for NAP consistency and sync health.
CREATE TABLE IF NOT EXISTS yext_listings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id     TEXT NOT NULL REFERENCES locations(location_id),
  publisher       TEXT NOT NULL,           -- e.g. 'Google', 'Yelp', 'Bing', 'Apple Maps'
  status          TEXT DEFAULT 'unknown',  -- 'synced', 'error', 'pending', 'suppressed'
  nap_match       INTEGER DEFAULT 0,       -- 1 = NAP consistent, 0 = mismatch
  last_checked    TEXT,
  UNIQUE(location_id, publisher)
);

CREATE INDEX IF NOT EXISTS idx_yext_location_id ON yext_listings(location_id);
