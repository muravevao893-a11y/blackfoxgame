CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  foxes NUMERIC NOT NULL DEFAULT 25000,
  crystals NUMERIC NOT NULL DEFAULT 0,
  bank NUMERIC NOT NULL DEFAULT 0,
  xp INT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 1,
  energy INT NOT NULL DEFAULT 10,
  vip_level INT NOT NULL DEFAULT 0,
  vip_until TIMESTAMP,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  referrer_id INT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_bonus_at TIMESTAMP,
  last_work_at TIMESTAMP,
  last_luck_at TIMESTAMP,
  garden_watered_at TIMESTAMP,
  income_boost_until TIMESTAMP,
  case_luck_until TIMESTAMP,
  luck_charges INT NOT NULL DEFAULT 0,
  pass_premium BOOLEAN NOT NULL DEFAULT FALSE,
  pass_xp INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_foxes ON users(foxes DESC);
CREATE INDEX IF NOT EXISTS idx_users_level ON users(level DESC);

CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  reward_foxes NUMERIC NOT NULL DEFAULT 0,
  reward_crystals NUMERIC NOT NULL DEFAULT 0,
  max_activations INT NOT NULL,
  activations INT NOT NULL DEFAULT 0,
  min_level INT NOT NULL DEFAULT 1,
  only_new BOOLEAN NOT NULL DEFAULT FALSE,
  only_vip BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_activations (
  id SERIAL PRIMARY KEY,
  promo_id INT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(promo_id, user_id)
);

CREATE TABLE IF NOT EXISTS marriages (
  id SERIAL PRIMARY KEY,
  user1_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user1_id),
  UNIQUE(user2_id),
  CHECK (user1_id <> user2_id)
);

CREATE TABLE IF NOT EXISTS user_cases (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id INT NOT NULL,
  amount INT NOT NULL DEFAULT 0,
  UNIQUE(user_id, case_id)
);

CREATE TABLE IF NOT EXISTS facilities (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  level INT NOT NULL DEFAULT 1,
  income NUMERIC NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  last_collect_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  video_cards INT NOT NULL DEFAULT 0,
  max_video_cards INT NOT NULL DEFAULT 10,
  tax_debt NUMERIC NOT NULL DEFAULT 0,
  tax_limit NUMERIC NOT NULL DEFAULT 5000000,
  account NUMERIC NOT NULL DEFAULT 0,
  last_tick_at TIMESTAMP,
  territory_m2 INT NOT NULL DEFAULT 120,
  business_m2 INT NOT NULL DEFAULT 120,
  trees_count INT NOT NULL DEFAULT 10,
  water INT NOT NULL DEFAULT 100,
  max_water INT NOT NULL DEFAULT 100,
  UNIQUE(user_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_facilities_user_kind ON facilities(user_id, kind);

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  amount INT NOT NULL DEFAULT 0,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(user_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_user ON inventory_items(user_id);

CREATE TABLE IF NOT EXISTS clans (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  owner_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank NUMERIC NOT NULL DEFAULT 0,
  xp INT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clan_members (
  id SERIAL PRIMARY KEY,
  clan_id INT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS market_lots (
  id SERIAL PRIMARY KEY,
  seller_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  amount INT NOT NULL DEFAULT 1,
  price NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sold_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_market_active ON market_lots(status, created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  meta TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS daily_progress (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  bonus_done BOOLEAN NOT NULL DEFAULT FALSE,
  casino_count INT NOT NULL DEFAULT 0,
  collect_done BOOLEAN NOT NULL DEFAULT FALSE,
  garden_done BOOLEAN NOT NULL DEFAULT FALSE,
  case_done BOOLEAN NOT NULL DEFAULT FALSE,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(user_id, day)
);

CREATE TABLE IF NOT EXISTS pass_rewards (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INT NOT NULL,
  premium BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, level, premium)
);

CREATE TABLE IF NOT EXISTS cooldowns (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, key)
);
