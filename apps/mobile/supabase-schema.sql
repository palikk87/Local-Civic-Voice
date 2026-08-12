-- ============================================
-- CIVIC VOICE - SUPABASE DATABASE SCHEMA
-- ============================================
-- Run this SQL in your Supabase SQL Editor
-- This creates all tables, indexes, RLS policies, and functions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 0. SYSTEM SETTINGS TABLE
-- Global constants for multi-session evolution
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default congress number (119th Congress: 2025-2027)
INSERT INTO system_settings (key, value, description) VALUES
  ('current_congress', '119', 'The current Congressional session number (e.g., 119 for 2025-2027)')
ON CONFLICT (key) DO NOTHING;

-- Function to get current congress number
CREATE OR REPLACE FUNCTION get_current_congress()
RETURNS INTEGER AS $$
  SELECT CAST(value AS INTEGER) FROM system_settings WHERE key = 'current_congress';
$$ LANGUAGE sql STABLE;

-- Function to update current congress (admin only)
CREATE OR REPLACE FUNCTION update_current_congress(new_congress INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE system_settings
  SET value = new_congress::TEXT, updated_at = NOW()
  WHERE key = 'current_congress';
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_current_congress TO authenticated, anon;
-- update_current_congress should only be called by admins via service role

-- ============================================
-- 1. PROFILES TABLE
-- Links to Supabase Auth users
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar TEXT,
  bio TEXT,
  location TEXT,
  joined_date TIMESTAMPTZ DEFAULT NOW(),
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  votes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for username lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- ============================================
-- 2. REPRESENTATIVES TABLE
-- Elected officials database
-- ============================================
CREATE TABLE IF NOT EXISTS representatives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('D', 'R', 'I')),
  state TEXT NOT NULL,
  district TEXT,
  chamber TEXT NOT NULL CHECK (chamber IN ('house', 'senate')),
  image_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  twitter TEXT,
  facebook TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for search and filtering
CREATE INDEX IF NOT EXISTS idx_representatives_chamber ON representatives(chamber);
CREATE INDEX IF NOT EXISTS idx_representatives_state ON representatives(state);
CREATE INDEX IF NOT EXISTS idx_representatives_party ON representatives(party);
CREATE INDEX IF NOT EXISTS idx_representatives_name ON representatives(name);

-- ============================================
-- 3. BILLS TABLE
-- Legislative bills with full text and metadata
-- ============================================
CREATE TYPE bill_status AS ENUM (
  'introduced',
  'in_committee',
  'passed_house',
  'passed_senate',
  'enacted',
  'vetoed',
  'signed_into_law'
);

CREATE TYPE bill_chamber AS ENUM ('house', 'senate');

CREATE TYPE bill_category AS ENUM (
  'healthcare',
  'education',
  'environment',
  'economy',
  'civil_rights',
  'defense',
  'immigration',
  'technology',
  'housing',
  'infrastructure'
);

CREATE TYPE projected_outcome AS ENUM (
  'likely_pass',
  'likely_fail',
  'uncertain',
  'unlikely_pass'
);

CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  congress_number INTEGER NOT NULL DEFAULT 119, -- Congressional session (e.g., 119 for 2025-2027)
  bill_number TEXT, -- Official bill number (e.g., "H.R.1234", "S.5678")
  title TEXT NOT NULL,
  short_title TEXT NOT NULL,
  status bill_status NOT NULL DEFAULT 'introduced',
  chamber bill_chamber NOT NULL,
  sponsor_id UUID REFERENCES representatives(id),
  introduced_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_action_date DATE DEFAULT CURRENT_DATE,
  category bill_category NOT NULL,
  full_text TEXT NOT NULL,
  simplified_text TEXT,
  real_world_impact TEXT,
  projected_outcome projected_outcome DEFAULT 'uncertain',
  -- Community vote tallies (denormalized for performance)
  yea_count INTEGER DEFAULT 0,
  nay_count INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  -- Official vote tallies (nullable)
  official_yea INTEGER,
  official_nay INTEGER,
  official_present INTEGER,
  official_not_voting INTEGER,
  -- Metadata
  is_trending BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for congress_number filtering (critical for multi-session queries)
CREATE INDEX IF NOT EXISTS idx_bills_congress_number ON bills(congress_number);
CREATE INDEX IF NOT EXISTS idx_bills_bill_number ON bills(bill_number);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_category ON bills(category);
CREATE INDEX IF NOT EXISTS idx_bills_chamber ON bills(chamber);
CREATE INDEX IF NOT EXISTS idx_bills_introduced_date ON bills(introduced_date DESC);
CREATE INDEX IF NOT EXISTS idx_bills_trending ON bills(is_trending) WHERE is_trending = TRUE;
CREATE INDEX IF NOT EXISTS idx_bills_total_votes ON bills(total_votes DESC);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_bills_search ON bills USING gin(
  to_tsvector('english', title || ' ' || short_title || ' ' || COALESCE(simplified_text, ''))
);

-- ============================================
-- 4. RELATED LAWS TABLE
-- References between bills and existing laws
-- ============================================
CREATE TYPE law_relationship AS ENUM (
  'amends',
  'conflicts',
  'supports',
  'references'
);

CREATE TABLE IF NOT EXISTS related_laws (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  law_name TEXT NOT NULL,
  relationship law_relationship NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_related_laws_bill ON related_laws(bill_id);

-- ============================================
-- 5. VOTES TABLE
-- User votes on bills (one vote per user per bill)
-- ============================================
CREATE TYPE vote_type AS ENUM ('yea', 'nay');

CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  congress_number INTEGER NOT NULL DEFAULT 119, -- Congressional session for historical tracking
  vote vote_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Enforce one vote per user per bill
  UNIQUE(user_id, bill_id)
);

-- Indexes for vote queries
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_bill ON votes(bill_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_bill ON votes(user_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_votes_congress ON votes(congress_number);

-- ============================================
-- 6. COMMENTS TABLE
-- User comments on bills
-- ============================================
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for comment queries
CREATE INDEX IF NOT EXISTS idx_comments_bill ON comments(bill_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);

-- ============================================
-- 7. FEED ITEMS TABLE
-- Activity feed for social features
-- ============================================
CREATE TYPE feed_item_type AS ENUM ('vote', 'comment', 'share');

CREATE TABLE IF NOT EXISTS feed_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type feed_item_type NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  vote_id UUID REFERENCES votes(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for feed queries
CREATE INDEX IF NOT EXISTS idx_feed_items_created ON feed_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_items_user ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_items_bill ON feed_items(bill_id);

-- ============================================
-- 8. FEED LIKES TABLE
-- Track which users liked which feed items
-- ============================================
CREATE TABLE IF NOT EXISTS feed_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feed_item_id UUID NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, feed_item_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_likes_user ON feed_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_likes_item ON feed_likes(feed_item_id);

-- ============================================
-- 9. FOLLOWS TABLE
-- User following relationships
-- ============================================
CREATE TABLE IF NOT EXISTS follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- ============================================
-- 10. DELEGATIONS TABLE
-- Liquid democracy delegations
-- ============================================
CREATE TABLE IF NOT EXISTS delegations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category bill_category,  -- NULL means all categories
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- One delegation per category per user
  UNIQUE(from_user_id, category),
  CHECK (from_user_id != to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_delegations_from ON delegations(from_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_to ON delegations(to_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_active ON delegations(is_active) WHERE is_active = TRUE;

-- ============================================
-- 11. DELEGATE PROFILES TABLE
-- Featured delegate experts
-- ============================================
CREATE TABLE IF NOT EXISTS delegate_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expertise bill_category[] NOT NULL DEFAULT '{}',
  delegator_count INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  yea_votes INTEGER DEFAULT 0,
  nay_votes INTEGER DEFAULT 0,
  bio TEXT,
  is_featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_delegate_profiles_featured ON delegate_profiles(is_featured) WHERE is_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_delegate_profiles_delegators ON delegate_profiles(delegator_count DESC);

-- ============================================
-- FUNCTIONS AND TRIGGERS
-- ============================================

-- Function to update bill vote counts
CREATE OR REPLACE FUNCTION update_bill_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bills SET
      yea_count = yea_count + CASE WHEN NEW.vote = 'yea' THEN 1 ELSE 0 END,
      nay_count = nay_count + CASE WHEN NEW.vote = 'nay' THEN 1 ELSE 0 END,
      total_votes = total_votes + 1,
      updated_at = NOW()
    WHERE id = NEW.bill_id;

    -- Update user's vote count
    UPDATE profiles SET
      votes_count = votes_count + 1,
      updated_at = NOW()
    WHERE id = NEW.user_id;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE bills SET
      yea_count = yea_count
        - CASE WHEN OLD.vote = 'yea' THEN 1 ELSE 0 END
        + CASE WHEN NEW.vote = 'yea' THEN 1 ELSE 0 END,
      nay_count = nay_count
        - CASE WHEN OLD.vote = 'nay' THEN 1 ELSE 0 END
        + CASE WHEN NEW.vote = 'nay' THEN 1 ELSE 0 END,
      updated_at = NOW()
    WHERE id = NEW.bill_id;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE bills SET
      yea_count = yea_count - CASE WHEN OLD.vote = 'yea' THEN 1 ELSE 0 END,
      nay_count = nay_count - CASE WHEN OLD.vote = 'nay' THEN 1 ELSE 0 END,
      total_votes = total_votes - 1,
      updated_at = NOW()
    WHERE id = OLD.bill_id;

    -- Update user's vote count
    UPDATE profiles SET
      votes_count = votes_count - 1,
      updated_at = NOW()
    WHERE id = OLD.user_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for vote count updates
DROP TRIGGER IF EXISTS trigger_update_bill_votes ON votes;
CREATE TRIGGER trigger_update_bill_votes
  AFTER INSERT OR UPDATE OR DELETE ON votes
  FOR EACH ROW EXECUTE FUNCTION update_bill_vote_counts();

-- Function to update feed item like counts
CREATE OR REPLACE FUNCTION update_feed_like_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feed_items SET likes_count = likes_count + 1 WHERE id = NEW.feed_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feed_items SET likes_count = likes_count - 1 WHERE id = OLD.feed_item_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for feed like updates
DROP TRIGGER IF EXISTS trigger_update_feed_likes ON feed_likes;
CREATE TRIGGER trigger_update_feed_likes
  AFTER INSERT OR DELETE ON feed_likes
  FOR EACH ROW EXECUTE FUNCTION update_feed_like_counts();

-- Function to update follower counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET followers_count = followers_count - 1 WHERE id = OLD.following_id;
    UPDATE profiles SET following_count = following_count - 1 WHERE id = OLD.follower_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for follow count updates
DROP TRIGGER IF EXISTS trigger_update_follows ON follows;
CREATE TRIGGER trigger_update_follows
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Function to update delegate profile counts
CREATE OR REPLACE FUNCTION update_delegator_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.is_active THEN
    UPDATE delegate_profiles SET delegator_count = delegator_count + 1 WHERE user_id = NEW.to_user_id;
  ELSIF TG_OP = 'DELETE' AND OLD.is_active THEN
    UPDATE delegate_profiles SET delegator_count = delegator_count - 1 WHERE user_id = OLD.to_user_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_active AND NOT NEW.is_active THEN
      UPDATE delegate_profiles SET delegator_count = delegator_count - 1 WHERE user_id = NEW.to_user_id;
    ELSIF NOT OLD.is_active AND NEW.is_active THEN
      UPDATE delegate_profiles SET delegator_count = delegator_count + 1 WHERE user_id = NEW.to_user_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for delegator count updates
DROP TRIGGER IF EXISTS trigger_update_delegators ON delegations;
CREATE TRIGGER trigger_update_delegators
  AFTER INSERT OR UPDATE OR DELETE ON delegations
  FOR EACH ROW EXECUTE FUNCTION update_delegator_counts();

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, username, display_name, avatar)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar',
      'https://api.dicebear.com/7.x/avataaars/png?seed=' || COALESCE(NEW.raw_user_meta_data->>'username', NEW.id::text)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to create feed item on vote
CREATE OR REPLACE FUNCTION create_vote_feed_item()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO feed_items (type, user_id, bill_id, vote_id)
  VALUES ('vote', NEW.user_id, NEW.bill_id, NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for feed item on vote
DROP TRIGGER IF EXISTS trigger_create_vote_feed ON votes;
CREATE TRIGGER trigger_create_vote_feed
  AFTER INSERT ON votes
  FOR EACH ROW EXECUTE FUNCTION create_vote_feed_item();

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE related_laws ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegate_profiles ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
-- Anyone can read profiles
CREATE POLICY "Profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

-- Users can update only their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- REPRESENTATIVES POLICIES
-- Anyone can read representatives
CREATE POLICY "Representatives are viewable by everyone" ON representatives
  FOR SELECT USING (true);

-- BILLS POLICIES
-- Anyone can read bills
CREATE POLICY "Bills are viewable by everyone" ON bills
  FOR SELECT USING (true);

-- RELATED LAWS POLICIES
-- Anyone can read related laws
CREATE POLICY "Related laws are viewable by everyone" ON related_laws
  FOR SELECT USING (true);

-- VOTES POLICIES
-- Anyone can read votes (for counts and transparency)
CREATE POLICY "Votes are viewable by everyone" ON votes
  FOR SELECT USING (true);

-- Only authenticated users can insert their own votes
CREATE POLICY "Authenticated users can vote" ON votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own votes
CREATE POLICY "Users can update own votes" ON votes
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own votes
CREATE POLICY "Users can delete own votes" ON votes
  FOR DELETE USING (auth.uid() = user_id);

-- COMMENTS POLICIES
-- Anyone can read comments
CREATE POLICY "Comments are viewable by everyone" ON comments
  FOR SELECT USING (true);

-- Only authenticated users can insert comments
CREATE POLICY "Authenticated users can comment" ON comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own comments
CREATE POLICY "Users can update own comments" ON comments
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments" ON comments
  FOR DELETE USING (auth.uid() = user_id);

-- FEED ITEMS POLICIES
-- Anyone can read feed items
CREATE POLICY "Feed items are viewable by everyone" ON feed_items
  FOR SELECT USING (true);

-- System creates feed items via triggers (no direct insert)
CREATE POLICY "System can create feed items" ON feed_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- FEED LIKES POLICIES
-- Anyone can read likes
CREATE POLICY "Feed likes are viewable by everyone" ON feed_likes
  FOR SELECT USING (true);

-- Authenticated users can like
CREATE POLICY "Authenticated users can like" ON feed_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can remove their own likes
CREATE POLICY "Users can unlike" ON feed_likes
  FOR DELETE USING (auth.uid() = user_id);

-- FOLLOWS POLICIES
-- Anyone can see follows
CREATE POLICY "Follows are viewable by everyone" ON follows
  FOR SELECT USING (true);

-- Authenticated users can follow
CREATE POLICY "Authenticated users can follow" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

-- Users can unfollow
CREATE POLICY "Users can unfollow" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

-- DELEGATIONS POLICIES
-- Users can see their own delegations
CREATE POLICY "Users can view own delegations" ON delegations
  FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- Authenticated users can create delegations
CREATE POLICY "Authenticated users can delegate" ON delegations
  FOR INSERT WITH CHECK (auth.uid() = from_user_id);

-- Users can update their own delegations
CREATE POLICY "Users can update own delegations" ON delegations
  FOR UPDATE USING (auth.uid() = from_user_id);

-- Users can delete their own delegations
CREATE POLICY "Users can delete own delegations" ON delegations
  FOR DELETE USING (auth.uid() = from_user_id);

-- DELEGATE PROFILES POLICIES
-- Anyone can view delegate profiles
CREATE POLICY "Delegate profiles are viewable by everyone" ON delegate_profiles
  FOR SELECT USING (true);

-- Users can update their own delegate profile
CREATE POLICY "Users can update own delegate profile" ON delegate_profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- SEED DATA: REAL U.S. CONGRESSIONAL REPRESENTATIVES (119th Congress)
-- ============================================
INSERT INTO representatives (id, name, party, state, district, chamber, image_url, contact_email, contact_phone, website, twitter) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Mike Johnson', 'R', 'LA', '4', 'house', 'https://www.congress.gov/img/member/j000299_200.jpg', NULL, '(202) 225-2777', 'https://mikejohnson.house.gov', '@SpeakerJohnson'),
  ('00000000-0000-0000-0000-000000000002', 'John Thune', 'R', 'SD', NULL, 'senate', 'https://www.congress.gov/img/member/t000250_200.jpg', NULL, '(202) 224-2321', 'https://thune.senate.gov', '@SenJohnThune'),
  ('00000000-0000-0000-0000-000000000003', 'Alexandria Ocasio-Cortez', 'D', 'NY', '14', 'house', 'https://www.congress.gov/img/member/o000172_200.jpg', NULL, '(202) 225-3965', 'https://ocasio-cortez.house.gov', '@RepAOC'),
  ('00000000-0000-0000-0000-000000000004', 'Bernie Sanders', 'I', 'VT', NULL, 'senate', 'https://www.congress.gov/img/member/s000033_200.jpg', NULL, '(202) 224-5141', 'https://sanders.senate.gov', '@SenSanders'),
  ('00000000-0000-0000-0000-000000000005', 'Ted Cruz', 'R', 'TX', NULL, 'senate', 'https://www.congress.gov/img/member/c001098_200.jpg', NULL, '(202) 224-5922', 'https://cruz.senate.gov', '@SenTedCruz'),
  ('00000000-0000-0000-0000-000000000006', 'Nancy Pelosi', 'D', 'CA', '11', 'house', 'https://www.congress.gov/img/member/p000197_200.jpg', NULL, '(202) 225-4965', 'https://pelosi.house.gov', '@SpeakerPelosi'),
  ('00000000-0000-0000-0000-000000000007', 'Chuck Schumer', 'D', 'NY', NULL, 'senate', 'https://www.congress.gov/img/member/s000148_200.jpg', NULL, '(202) 224-6542', 'https://schumer.senate.gov', '@SenSchumer'),
  ('00000000-0000-0000-0000-000000000008', 'Mitch McConnell', 'R', 'KY', NULL, 'senate', 'https://www.congress.gov/img/member/m000355_200.jpg', NULL, '(202) 224-2541', 'https://mcconnell.senate.gov', '@LeaderMcConnell'),
  ('00000000-0000-0000-0000-000000000009', 'Maxine Waters', 'D', 'CA', '43', 'house', 'https://www.congress.gov/img/member/w000187_200.jpg', NULL, '(202) 225-2201', 'https://waters.house.gov', '@RepMaxineWaters'),
  ('00000000-0000-0000-0000-000000000010', 'Marjorie Taylor Greene', 'R', 'GA', '14', 'house', 'https://www.congress.gov/img/member/g000061_200.jpg', NULL, '(202) 225-5211', 'https://greene.house.gov', '@RepMTG'),
  ('00000000-0000-0000-0000-000000000011', 'Marco Rubio', 'R', 'FL', NULL, 'senate', 'https://www.congress.gov/img/member/r000595_200.jpg', NULL, '(202) 224-3041', 'https://rubio.senate.gov', '@SenRubioPress'),
  ('00000000-0000-0000-0000-000000000012', 'Elizabeth Warren', 'D', 'MA', NULL, 'senate', 'https://www.congress.gov/img/member/w000817_200.jpg', NULL, '(202) 224-4543', 'https://warren.senate.gov', '@SenWarren')
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: REAL CONGRESSIONAL BILLS (from Congress.gov most-viewed)
-- ============================================
INSERT INTO bills (id, title, short_title, status, chamber, sponsor_id, introduced_date, last_action_date, category, full_text, simplified_text, real_world_impact, projected_outcome, yea_count, nay_count, total_votes, is_trending) VALUES
  (
    '00000000-0000-0000-0001-000000000001',
    'Social Security Fairness Act of 2023',
    'Social Security Fairness Act',
    'passed_house',
    'house',
    '00000000-0000-0000-0000-000000000006',
    '2023-01-09',
    '2024-11-12',
    'economy',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Social Security Fairness Act of 2023".\n\nSEC. 2. REPEAL OF WINDFALL ELIMINATION PROVISION.\n(a) IN GENERAL.—Section 215(a) of the Social Security Act (42 U.S.C. 415(a)) is amended by striking paragraph (7).\n(b) CONFORMING AMENDMENTS.—(1) Section 215(a)(1)(B)(i) of such Act (42 U.S.C. 415(a)(1)(B)(i)) is amended by striking "and, if applicable, paragraph (7)".\n(c) EFFECTIVE DATE.—The amendments made by this section shall apply with respect to monthly insurance benefits payable for months after December 2023.\n\nSEC. 3. REPEAL OF GOVERNMENT PENSION OFFSET.\n(a) IN GENERAL.—Section 202(k) of the Social Security Act (42 U.S.C. 402(k)) is amended by striking paragraph (5).\n(b) EFFECTIVE DATE.—The amendment made by this section shall apply with respect to monthly insurance benefits payable for months after December 2023.',
    'Repeals two provisions that reduce Social Security benefits for public sector workers like teachers, firefighters, and police officers. Eliminates the Windfall Elimination Provision (WEP) and the Government Pension Offset (GPO) that affect approximately 2.8 million Americans.',
    'Retired teachers could see their benefits increase from $900/month to $1,400/month or more. Approximately 2.8 million people would see immediate benefit increases averaging $360/month. Spouses and survivors of public employees would receive full benefits.',
    'likely_pass',
    45200,
    8100,
    53300,
    true
  ),
  (
    '00000000-0000-0000-0001-000000000002',
    'Tax Relief for American Families and Workers Act of 2024',
    'Tax Relief Act',
    'passed_house',
    'senate',
    '00000000-0000-0000-0000-000000000001',
    '2024-01-17',
    '2024-08-01',
    'economy',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Tax Relief for American Families and Workers Act of 2024".\n\nSEC. 2. CHILD TAX CREDIT IMPROVEMENTS.\n(a) INCREASE IN REFUNDABLE PORTION.—Section 24(d)(1)(B) is amended by striking "$1,600" and inserting "$1,800" for 2023, "$1,900" for 2024, and "$2,000" for 2025.\n(b) INFLATION ADJUSTMENT.—The child tax credit amount shall be adjusted for inflation beginning in 2024.\n\nSEC. 3. BUSINESS PROVISIONS.\n(a) SECTION 174 RESEARCH EXPENSES.—Research and experimental expenditures shall be fully deductible in the year incurred through 2025.\n(b) BONUS DEPRECIATION.—100% bonus depreciation is restored through 2025.',
    'Expands the Child Tax Credit refundable amount from $1,600 to $2,000 per child. Restores immediate deduction for business R&D expenses and 100% bonus depreciation for businesses through 2025.',
    'A family with two children earning $30,000 could receive up to $4,000 in refundable credits. Approximately 16 million children would benefit. Families earning as little as $2,500 would qualify for larger credits.',
    'uncertain',
    38700,
    12400,
    51100,
    true
  ),
  (
    '00000000-0000-0000-0001-000000000003',
    'Secure the Border Act of 2023',
    'Secure the Border Act',
    'passed_house',
    'senate',
    '00000000-0000-0000-0000-000000000005',
    '2023-01-09',
    '2024-05-23',
    'immigration',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Secure the Border Act of 2023".\n\nSEC. 2. BORDER WALL CONSTRUCTION.\n(a) RESUMPTION.—The Secretary of Homeland Security shall resume construction of the border wall system.\n(b) AUTHORIZATION.—$2,000,000,000 is authorized annually for wall construction.\n\nSEC. 3. ASYLUM REFORMS.\n(a) SAFE THIRD COUNTRY.—Asylum seekers must apply in the first safe country they reach.\n(b) CREDIBLE FEAR STANDARD.—The credible fear standard is raised to "more likely than not."\n\nSEC. 4. MANDATORY E-VERIFY.\nAll employers shall participate in the E-Verify system within 3 years.',
    'Resumes border wall construction with $2 billion annually. Requires asylum seekers to apply in the first safe country they reach. Mandates all employers use E-Verify within 3 years.',
    'Physical barriers would be constructed along additional miles of the border. Many asylum seekers would be returned to Mexico or other countries while claims are processed. All businesses would need to verify worker eligibility electronically.',
    'unlikely_pass',
    24600,
    31200,
    55800,
    true
  ),
  (
    '00000000-0000-0000-0001-000000000004',
    'Treat and Reduce Obesity Act of 2023',
    'Treat and Reduce Obesity Act',
    'in_committee',
    'senate',
    '00000000-0000-0000-0000-000000000004',
    '2023-02-28',
    '2024-07-15',
    'healthcare',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Treat and Reduce Obesity Act of 2023".\n\nSEC. 2. COVERAGE OF INTENSIVE BEHAVIORAL THERAPY.\n(a) IN GENERAL.—Section 1861(s)(2) of the Social Security Act is amended to include coverage for intensive behavioral therapy for obesity.\n(b) COVERED SERVICES.—Intensive behavioral therapy shall include: (1) Screening for obesity (2) Dietary assessment (3) Intensive behavioral counseling (4) Ongoing monitoring and support\n\nSEC. 3. COVERAGE OF PRESCRIPTION DRUGS FOR WEIGHT LOSS.\n(a) PART D COVERAGE.—Medicare Part D shall cover FDA-approved medications for chronic weight management.\n(b) CONDITIONS.—Coverage is conditioned on participation in behavioral counseling programs.',
    'Expands Medicare coverage to include obesity treatment including intensive behavioral therapy and weight-loss medications like Ozempic and Wegovy. Patients must participate in behavioral programs to receive drug coverage.',
    'Approximately 20 million Medicare beneficiaries with obesity could access comprehensive treatment. New medications would become affordable. Treating obesity can prevent or improve diabetes, heart disease, and joint problems.',
    'likely_pass',
    42300,
    7800,
    50100,
    true
  ),
  (
    '00000000-0000-0000-0001-000000000005',
    'Protecting Americans from Foreign Adversary Controlled Applications Act',
    'TikTok Ban Act',
    'signed_into_law',
    'house',
    '00000000-0000-0000-0000-000000000001',
    '2024-03-05',
    '2024-04-24',
    'technology',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Protecting Americans from Foreign Adversary Controlled Applications Act".\n\nSEC. 2. PROHIBITION OF FOREIGN ADVERSARY CONTROLLED APPLICATIONS.\n(a) IN GENERAL.—It shall be unlawful for an entity to distribute, maintain, or update a foreign adversary controlled application.\n(b) FOREIGN ADVERSARY.—The term "foreign adversary" includes China, Russia, Iran, and North Korea.\n(c) COVERED APPLICATION.—ByteDance-owned applications including TikTok are covered.\n\nSEC. 3. QUALIFIED DIVESTITURE.\n(a) SAFE HARBOR.—A qualified divestiture to a non-foreign adversary entity provides a safe harbor.\n(b) TIMELINE.—Divestiture must occur within 270 days, with a possible 90-day extension.',
    'Requires TikTok to be sold by its Chinese parent company ByteDance within 270-360 days or face a ban in the United States. Applies to applications controlled by foreign adversaries including China, Russia, Iran, and North Korea.',
    'If ByteDance does not sell, TikTok could be unavailable in the US by early 2025. 170 million American users would lose access. An estimated 5 million Americans who earn income on TikTok would need to migrate to other platforms.',
    'likely_pass',
    31400,
    28900,
    60300,
    true
  ),
  (
    '00000000-0000-0000-0001-000000000006',
    'Kids Online Safety Act',
    'KOSA',
    'passed_house',
    'senate',
    '00000000-0000-0000-0000-000000000007',
    '2023-05-02',
    '2024-07-30',
    'technology',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Kids Online Safety Act".\n\nSEC. 2. DUTY OF CARE.\n(a) IN GENERAL.—Covered platforms shall act in the best interests of minors using their services.\n(b) PREVENTION OF HARMS.—Platforms must prevent and mitigate: (1) Promotion of suicide, self-harm, and eating disorders (2) Bullying and harassment (3) Sexual exploitation (4) Sale of illegal substances to minors\n\nSEC. 3. SAFEGUARDS FOR MINORS.\n(a) OPTIONS.—Platforms must provide options to: (1) Protect minor information (2) Disable addictive product features (3) Opt out of personalized algorithmic recommendations\n(b) DEFAULT SETTINGS.—Strongest privacy settings shall be the default for minors.',
    'Requires social media platforms to protect children from harmful content and addictive features. Strongest privacy settings must be default for users under 17. Kids can turn off addictive features like autoplay and algorithmic feeds.',
    'Default protections would shield kids from harmful content. Parents would get new tools to see what content their kids access. By reducing exposure to harmful content and addictive algorithms, could help address the youth mental health crisis.',
    'likely_pass',
    48900,
    6200,
    55100,
    true
  ),
  (
    '00000000-0000-0000-0001-000000000007',
    'Servicemember Quality of Life Improvement and National Defense Authorization Act for Fiscal Year 2025',
    'FY2025 NDAA',
    'in_committee',
    'house',
    '00000000-0000-0000-0000-000000000001',
    '2024-04-17',
    '2024-12-01',
    'defense',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Servicemember Quality of Life Improvement and National Defense Authorization Act for Fiscal Year 2025".\n\nSEC. 2. AUTHORIZATION OF APPROPRIATIONS.\nFunds are authorized for fiscal year 2025 for military activities of the Department of Defense and military construction.\n\nSEC. 3. MILITARY PAY INCREASE.\nMilitary basic pay is increased by 4.5% effective January 1, 2025.\n\nSEC. 4. HOUSING ALLOWANCE.\nBasic Allowance for Housing is increased to address housing cost inflation.\n\nSEC. 5. CHILDCARE.\nExpanded on-base childcare capacity and increased subsidies for off-base care.',
    'The annual defense authorization bill that sets military pay, benefits, and policy for 2025. Includes a 4.5% pay raise, increased housing allowances, expanded childcare for military families, and new programs for military spouse employment.',
    'An E-5 Sergeant would see about $200 more per month. Housing allowances would better match actual costs. Expanded childcare could reduce costs by $5,000-10,000 per year. Spouse employment programs help address the 21% military spouse unemployment rate.',
    'likely_pass',
    35600,
    8900,
    44500,
    false
  ),
  (
    '00000000-0000-0000-0001-000000000008',
    'Antisemitism Awareness Act of 2023',
    'Antisemitism Awareness Act',
    'passed_house',
    'senate',
    '00000000-0000-0000-0000-000000000001',
    '2023-10-26',
    '2024-05-01',
    'civil_rights',
    E'SEC. 1. SHORT TITLE.\nThis Act may be cited as the "Antisemitism Awareness Act of 2023".\n\nSEC. 2. FINDINGS.\nCongress finds that: (1) Antisemitic incidents have increased dramatically on college campuses. (2) Jewish students have a right to learn free from discrimination and harassment. (3) A clear definition of antisemitism is needed for enforcement.\n\nSEC. 3. ADOPTION OF DEFINITION.\n(a) IN GENERAL.—The Department of Education shall use the International Holocaust Remembrance Alliance (IHRA) Working Definition of Antisemitism when reviewing civil rights complaints.\n(b) EXAMPLES.—The definition includes examples such as: (1) Calling for violence against Jews (2) Denying the Holocaust (3) Holding Jews collectively responsible for Israel actions (4) Applying double standards to Israel',
    'Requires the Department of Education to use the IHRA definition of antisemitism for Title VI enforcement on college campuses. Applies to federally-funded educational institutions.',
    'Would provide clearer standards for reporting and addressing antisemitic harassment on campus. Schools would need to address antisemitism complaints using the IHRA definition. Critics argue some examples could chill legitimate criticism of Israeli government policies.',
    'uncertain',
    29800,
    18700,
    48500,
    false
  )
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: RELATED LAWS FOR REAL BILLS
-- ============================================
INSERT INTO related_laws (bill_id, law_name, relationship, description) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Social Security Act of 1935', 'amends', 'Repeals the WEP and GPO provisions added in 1983 that reduced benefits for public workers'),
  ('00000000-0000-0000-0001-000000000002', 'Tax Cuts and Jobs Act of 2017', 'amends', 'Restores provisions that were set to expire or phase out under the 2017 tax law'),
  ('00000000-0000-0000-0001-000000000002', 'American Rescue Plan Act of 2021', 'references', 'Builds on expanded Child Tax Credit from pandemic relief legislation'),
  ('00000000-0000-0000-0001-000000000003', 'Immigration and Nationality Act', 'amends', 'Significantly modifies asylum procedures established under current immigration law'),
  ('00000000-0000-0000-0001-000000000003', 'Illegal Immigration Reform and Immigrant Responsibility Act', 'amends', 'Strengthens enforcement provisions from the 1996 immigration reform'),
  ('00000000-0000-0000-0001-000000000004', 'Social Security Act - Medicare', 'amends', 'Expands covered services under Medicare Parts B and D'),
  ('00000000-0000-0000-0001-000000000004', 'Affordable Care Act', 'supports', 'Builds on ACA preventive care requirements'),
  ('00000000-0000-0000-0001-000000000005', 'International Emergency Economic Powers Act', 'references', 'Uses similar authority as IEEPA for restricting foreign transactions'),
  ('00000000-0000-0000-0001-000000000006', 'Children''s Online Privacy Protection Act (COPPA)', 'supports', 'Expands protections beyond the under-13 scope of COPPA to all minors'),
  ('00000000-0000-0000-0001-000000000006', 'Section 230 of Communications Decency Act', 'amends', 'Creates new liability for platforms regarding minor safety'),
  ('00000000-0000-0000-0001-000000000007', 'National Defense Authorization Act for FY2024', 'references', 'Continues and modifies programs from the prior year defense bill'),
  ('00000000-0000-0000-0001-000000000008', 'Title VI of the Civil Rights Act of 1964', 'supports', 'Provides interpretation guidance for existing civil rights protections')
ON CONFLICT DO NOTHING;

-- ============================================
-- HELPER VIEWS
-- ============================================

-- View for bills with sponsor info
CREATE OR REPLACE VIEW bills_with_sponsors AS
SELECT
  b.*,
  r.name as sponsor_name,
  r.party as sponsor_party,
  r.state as sponsor_state,
  r.image_url as sponsor_image
FROM bills b
LEFT JOIN representatives r ON b.sponsor_id = r.id;

-- View for feed with user and bill info
CREATE OR REPLACE VIEW feed_with_details AS
SELECT
  f.*,
  p.username,
  p.display_name,
  p.avatar as user_avatar,
  b.short_title as bill_title,
  b.category as bill_category,
  v.vote as vote_type
FROM feed_items f
JOIN profiles p ON f.user_id = p.id
JOIN bills b ON f.bill_id = b.id
LEFT JOIN votes v ON f.vote_id = v.id;

-- ============================================
-- FUNCTIONS FOR API QUERIES
-- ============================================

-- Function to search bills
CREATE OR REPLACE FUNCTION search_bills(
  search_query TEXT DEFAULT NULL,
  filter_category bill_category DEFAULT NULL,
  filter_status bill_status DEFAULT NULL,
  sort_by TEXT DEFAULT 'newest',
  page_size INTEGER DEFAULT 20,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  short_title TEXT,
  status bill_status,
  chamber bill_chamber,
  category bill_category,
  simplified_text TEXT,
  yea_count INTEGER,
  nay_count INTEGER,
  total_votes INTEGER,
  projected_outcome projected_outcome,
  introduced_date DATE,
  is_trending BOOLEAN,
  sponsor_name TEXT,
  sponsor_party TEXT,
  sponsor_image TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.title,
    b.short_title,
    b.status,
    b.chamber,
    b.category,
    b.simplified_text,
    b.yea_count,
    b.nay_count,
    b.total_votes,
    b.projected_outcome,
    b.introduced_date,
    b.is_trending,
    r.name as sponsor_name,
    r.party as sponsor_party,
    r.image_url as sponsor_image
  FROM bills b
  LEFT JOIN representatives r ON b.sponsor_id = r.id
  WHERE
    (search_query IS NULL OR
     to_tsvector('english', b.title || ' ' || b.short_title || ' ' || COALESCE(b.simplified_text, ''))
     @@ plainto_tsquery('english', search_query))
    AND (filter_category IS NULL OR b.category = filter_category)
    AND (filter_status IS NULL OR b.status = filter_status)
  ORDER BY
    CASE WHEN sort_by = 'newest' THEN b.introduced_date END DESC,
    CASE WHEN sort_by = 'trending' THEN b.total_votes END DESC,
    CASE WHEN sort_by = 'oldest' THEN b.introduced_date END ASC
  LIMIT page_size
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION search_bills TO authenticated, anon;

-- ============================================
-- REPRESENTATION GAP VIEW
-- Calculates discrepancy between public and official votes
-- ============================================
CREATE OR REPLACE VIEW representation_gap AS
SELECT
  b.id AS bill_id,
  b.short_title AS bill_title,
  b.congress_number,
  -- Calculate Public (Civic Voice) approval percentage
  CASE
    WHEN (b.yea_count + b.nay_count) > 0
    THEN ROUND((b.yea_count::numeric / (b.yea_count + b.nay_count)) * 100, 1)
    ELSE 0
  END AS public_approval_pct,
  -- Calculate Official (Congress) approval percentage
  CASE
    WHEN (COALESCE(b.official_yea, 0) + COALESCE(b.official_nay, 0)) > 0
    THEN ROUND((b.official_yea::numeric / (b.official_yea + b.official_nay)) * 100, 1)
    ELSE 0
  END AS official_approval_pct,
  -- Calculate the absolute gap
  ABS(
    CASE WHEN (b.yea_count + b.nay_count) > 0
         THEN (b.yea_count::numeric / (b.yea_count + b.nay_count)) * 100
         ELSE 0 END
    -
    CASE WHEN (COALESCE(b.official_yea, 0) + COALESCE(b.official_nay, 0)) > 0
         THEN (b.official_yea::numeric / (b.official_yea + b.official_nay)) * 100
         ELSE 0 END
  ) AS gap_percentage,
  -- Flag significant gaps (> 30%)
  ABS(
    CASE WHEN (b.yea_count + b.nay_count) > 0
         THEN (b.yea_count::numeric / (b.yea_count + b.nay_count)) * 100
         ELSE 0 END
    -
    CASE WHEN (COALESCE(b.official_yea, 0) + COALESCE(b.official_nay, 0)) > 0
         THEN (b.official_yea::numeric / (b.official_yea + b.official_nay)) * 100
         ELSE 0 END
  ) > 30 AS has_significant_gap,
  -- Total votes for context
  b.total_votes AS public_total_votes,
  COALESCE(b.official_yea, 0) + COALESCE(b.official_nay, 0) AS official_total_votes
FROM bills b
WHERE b.total_votes > 0 OR b.official_yea IS NOT NULL;

-- ============================================
-- ADD ZIP CODE TO PROFILES
-- For geographic vote analysis
-- ============================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS congressional_district TEXT;

-- Index for geographic queries
CREATE INDEX IF NOT EXISTS idx_profiles_zip ON profiles(zip_code);
CREATE INDEX IF NOT EXISTS idx_profiles_state ON profiles(state);

-- ============================================
-- ADD CONGRESS NUMBER TO BILLS
-- For linking to Congress.gov
-- ============================================
ALTER TABLE bills ADD COLUMN IF NOT EXISTS congress_number TEXT; -- e.g., "H.R.82", "S.596"
ALTER TABLE bills ADD COLUMN IF NOT EXISTS congress_url TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS citizens_brief JSONB; -- AI-generated Citizen's Brief

-- ============================================
-- FUNCTION: Get bills with representation gaps
-- ============================================
CREATE OR REPLACE FUNCTION get_bills_with_gaps(
  min_gap_pct NUMERIC DEFAULT 0,
  min_votes INTEGER DEFAULT 100,
  limit_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  bill_id UUID,
  bill_title TEXT,
  congress_number TEXT,
  public_approval_pct NUMERIC,
  official_approval_pct NUMERIC,
  gap_percentage NUMERIC,
  has_significant_gap BOOLEAN,
  public_total_votes BIGINT,
  official_total_votes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rg.bill_id,
    rg.bill_title,
    rg.congress_number,
    rg.public_approval_pct,
    rg.official_approval_pct,
    rg.gap_percentage,
    rg.has_significant_gap,
    rg.public_total_votes,
    rg.official_total_votes
  FROM representation_gap rg
  WHERE rg.gap_percentage >= min_gap_pct
    AND rg.public_total_votes >= min_votes
  ORDER BY rg.gap_percentage DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_bills_with_gaps TO authenticated, anon;

-- ============================================
-- MULTI-SESSION CONGRESS EVOLUTION FUNCTIONS
-- These functions support querying bills across congressional sessions
-- ============================================

-- Get bills for the CURRENT congress only (default app behavior)
CREATE OR REPLACE FUNCTION get_current_congress_bills(
  p_limit INTEGER DEFAULT 50,
  p_category bill_category DEFAULT NULL,
  p_status bill_status DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  congress_number INTEGER,
  bill_number TEXT,
  title TEXT,
  short_title TEXT,
  status bill_status,
  chamber bill_chamber,
  category bill_category,
  simplified_text TEXT,
  weight_score NUMERIC,
  yea_count INTEGER,
  nay_count INTEGER,
  total_votes INTEGER,
  introduced_date DATE,
  sponsor_name TEXT,
  sponsor_party TEXT
) AS $$
DECLARE
  v_current_congress INTEGER;
BEGIN
  v_current_congress := get_current_congress();

  RETURN QUERY
  SELECT
    b.id,
    b.congress_number,
    b.bill_number,
    b.title,
    b.short_title,
    b.status,
    b.chamber,
    b.category,
    b.simplified_text,
    b.weight_score,
    b.yea_count,
    b.nay_count,
    b.total_votes,
    b.introduced_date,
    r.name as sponsor_name,
    r.party as sponsor_party
  FROM bills b
  LEFT JOIN representatives r ON b.sponsor_id = r.id
  WHERE b.congress_number = v_current_congress
    AND (p_category IS NULL OR b.category = p_category)
    AND (p_status IS NULL OR b.status = p_status)
  ORDER BY b.weight_score DESC NULLS LAST, b.introduced_date DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get HISTORICAL bills (all previous congresses, not current)
CREATE OR REPLACE FUNCTION get_historical_bills(
  p_congress_number INTEGER DEFAULT NULL, -- NULL = all previous congresses
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_category bill_category DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  congress_number INTEGER,
  bill_number TEXT,
  title TEXT,
  short_title TEXT,
  status bill_status,
  chamber bill_chamber,
  category bill_category,
  simplified_text TEXT,
  weight_score NUMERIC,
  yea_count INTEGER,
  nay_count INTEGER,
  total_votes INTEGER,
  introduced_date DATE,
  sponsor_name TEXT,
  sponsor_party TEXT,
  congress_label TEXT -- e.g., "118th Congress (2023-2025)"
) AS $$
DECLARE
  v_current_congress INTEGER;
BEGIN
  v_current_congress := get_current_congress();

  RETURN QUERY
  SELECT
    b.id,
    b.congress_number,
    b.bill_number,
    b.title,
    b.short_title,
    b.status,
    b.chamber,
    b.category,
    b.simplified_text,
    b.weight_score,
    b.yea_count,
    b.nay_count,
    b.total_votes,
    b.introduced_date,
    r.name as sponsor_name,
    r.party as sponsor_party,
    CASE
      WHEN b.congress_number = 119 THEN '119th Congress (2025-2027)'
      WHEN b.congress_number = 118 THEN '118th Congress (2023-2025)'
      WHEN b.congress_number = 117 THEN '117th Congress (2021-2023)'
      WHEN b.congress_number = 116 THEN '116th Congress (2019-2021)'
      ELSE b.congress_number::TEXT || 'th Congress'
    END as congress_label
  FROM bills b
  LEFT JOIN representatives r ON b.sponsor_id = r.id
  WHERE b.congress_number < v_current_congress
    AND (p_congress_number IS NULL OR b.congress_number = p_congress_number)
    AND (p_category IS NULL OR b.category = p_category)
  ORDER BY b.congress_number DESC, b.introduced_date DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get user's voting history across all congresses
CREATE OR REPLACE FUNCTION get_user_vote_history(
  p_user_id UUID,
  p_current_only BOOLEAN DEFAULT FALSE,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  vote_id UUID,
  bill_id UUID,
  vote vote_type,
  voted_at TIMESTAMPTZ,
  congress_number INTEGER,
  bill_title TEXT,
  bill_short_title TEXT,
  bill_status bill_status,
  bill_category bill_category,
  is_current_congress BOOLEAN
) AS $$
DECLARE
  v_current_congress INTEGER;
BEGIN
  v_current_congress := get_current_congress();

  RETURN QUERY
  SELECT
    v.id as vote_id,
    v.bill_id,
    v.vote,
    v.created_at as voted_at,
    b.congress_number,
    b.title as bill_title,
    b.short_title as bill_short_title,
    b.status as bill_status,
    b.category as bill_category,
    (b.congress_number = v_current_congress) as is_current_congress
  FROM votes v
  JOIN bills b ON v.bill_id = b.id
  WHERE v.user_id = p_user_id
    AND (NOT p_current_only OR b.congress_number = v_current_congress)
  ORDER BY v.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get statistics for a specific congress
CREATE OR REPLACE FUNCTION get_congress_stats(p_congress_number INTEGER DEFAULT NULL)
RETURNS TABLE (
  congress_number INTEGER,
  congress_label TEXT,
  total_bills BIGINT,
  bills_enacted BIGINT,
  bills_vetoed BIGINT,
  total_community_votes BIGINT,
  unique_voters BIGINT
) AS $$
DECLARE
  v_congress INTEGER;
BEGIN
  v_congress := COALESCE(p_congress_number, get_current_congress());

  RETURN QUERY
  SELECT
    v_congress as congress_number,
    CASE
      WHEN v_congress = 119 THEN '119th Congress (2025-2027)'
      WHEN v_congress = 118 THEN '118th Congress (2023-2025)'
      WHEN v_congress = 117 THEN '117th Congress (2021-2023)'
      ELSE v_congress::TEXT || 'th Congress'
    END as congress_label,
    COUNT(DISTINCT b.id) as total_bills,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status IN ('enacted', 'signed_into_law')) as bills_enacted,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'vetoed') as bills_vetoed,
    COALESCE(SUM(b.total_votes), 0) as total_community_votes,
    COUNT(DISTINCT v.user_id) as unique_voters
  FROM bills b
  LEFT JOIN votes v ON b.id = v.bill_id
  WHERE b.congress_number = v_congress
  GROUP BY v_congress;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get list of all congresses with data
CREATE OR REPLACE FUNCTION get_available_congresses()
RETURNS TABLE (
  congress_number INTEGER,
  congress_label TEXT,
  bill_count BIGINT,
  is_current BOOLEAN
) AS $$
DECLARE
  v_current_congress INTEGER;
BEGIN
  v_current_congress := get_current_congress();

  RETURN QUERY
  SELECT
    b.congress_number,
    CASE
      WHEN b.congress_number = 119 THEN '119th Congress (2025-2027)'
      WHEN b.congress_number = 118 THEN '118th Congress (2023-2025)'
      WHEN b.congress_number = 117 THEN '117th Congress (2021-2023)'
      WHEN b.congress_number = 116 THEN '116th Congress (2019-2021)'
      ELSE b.congress_number::TEXT || 'th Congress'
    END as congress_label,
    COUNT(*) as bill_count,
    (b.congress_number = v_current_congress) as is_current
  FROM bills b
  WHERE b.congress_number IS NOT NULL
  GROUP BY b.congress_number
  ORDER BY b.congress_number DESC;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_current_congress_bills TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_historical_bills TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_user_vote_history TO authenticated;
GRANT EXECUTE ON FUNCTION get_congress_stats TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_available_congresses TO authenticated, anon;

-- ============================================
-- VOICE WEIGHT COLUMNS FOR BILLS
-- For calculating bill impact scores
-- ============================================
ALTER TABLE bills ADD COLUMN IF NOT EXISTS cosponsor_count INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS amendment_count INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS weight_score NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS weight_last_calculated TIMESTAMPTZ;

-- Index for sorting by weight score
CREATE INDEX IF NOT EXISTS idx_bills_weight_score ON bills(weight_score DESC);

-- ============================================
-- FUNCTION: Calculate Voice Weight for a bill
-- Formula: W = (cosponsor_count * 1.5) + (amendment_count * 2.0) + (action_status_rank * 5.0)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_voice_weight(
  p_status bill_status,
  p_cosponsor_count INTEGER DEFAULT 0,
  p_amendment_count INTEGER DEFAULT 0
)
RETURNS NUMERIC AS $$
DECLARE
  v_status_rank INTEGER;
  v_weight NUMERIC;
BEGIN
  -- Determine action status rank
  CASE p_status
    WHEN 'introduced' THEN v_status_rank := 1;
    WHEN 'in_committee' THEN v_status_rank := 3;
    WHEN 'passed_house' THEN v_status_rank := 5;
    WHEN 'passed_senate' THEN v_status_rank := 5;
    WHEN 'enacted' THEN v_status_rank := 10;
    WHEN 'signed_into_law' THEN v_status_rank := 10;
    WHEN 'vetoed' THEN v_status_rank := 2;
    ELSE v_status_rank := 1;
  END CASE;

  -- Calculate weight: W = (cosponsor * 1.5) + (amendment * 2.0) + (status * 5.0)
  v_weight := (COALESCE(p_cosponsor_count, 0) * 1.5) +
              (COALESCE(p_amendment_count, 0) * 2.0) +
              (v_status_rank * 5.0);

  RETURN ROUND(v_weight, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- FUNCTION: Update weight score for a single bill
-- ============================================
CREATE OR REPLACE FUNCTION update_bill_weight_score(p_bill_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE bills
  SET
    weight_score = calculate_voice_weight(status, cosponsor_count, amendment_count),
    weight_last_calculated = NOW(),
    updated_at = NOW()
  WHERE id = p_bill_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Recalculate all bill weight scores
-- Called by the scheduled Edge Function every 6 hours
-- ============================================
CREATE OR REPLACE FUNCTION recalculate_all_weight_scores()
RETURNS TABLE (
  updated_count INTEGER,
  execution_time INTERVAL
) AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_updated INTEGER;
BEGIN
  v_start_time := NOW();

  UPDATE bills
  SET
    weight_score = calculate_voice_weight(status, cosponsor_count, amendment_count),
    weight_last_calculated = NOW(),
    updated_at = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN QUERY SELECT v_updated, NOW() - v_start_time;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION calculate_voice_weight TO authenticated, anon;
GRANT EXECUTE ON FUNCTION update_bill_weight_score TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_all_weight_scores TO authenticated;

-- ============================================
-- TRIGGER: Auto-update weight score when bill changes
-- ============================================
CREATE OR REPLACE FUNCTION trigger_update_bill_weight()
RETURNS TRIGGER AS $$
BEGIN
  NEW.weight_score := calculate_voice_weight(NEW.status, NEW.cosponsor_count, NEW.amendment_count);
  NEW.weight_last_calculated := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_bill_weight_update ON bills;
CREATE TRIGGER trigger_bill_weight_update
  BEFORE INSERT OR UPDATE OF status, cosponsor_count, amendment_count ON bills
  FOR EACH ROW EXECUTE FUNCTION trigger_update_bill_weight();

-- ============================================
-- FUNCTION: Get Daily Bill Digest (top weighted bills)
-- ============================================
CREATE OR REPLACE FUNCTION get_daily_bill_digest(
  p_limit INTEGER DEFAULT 10,
  p_category bill_category DEFAULT NULL,
  p_min_weight NUMERIC DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  short_title TEXT,
  status bill_status,
  chamber bill_chamber,
  category bill_category,
  simplified_text TEXT,
  weight_score NUMERIC,
  cosponsor_count INTEGER,
  amendment_count INTEGER,
  yea_count INTEGER,
  nay_count INTEGER,
  total_votes INTEGER,
  projected_outcome projected_outcome,
  introduced_date DATE,
  sponsor_name TEXT,
  sponsor_party TEXT,
  sponsor_image TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.title,
    b.short_title,
    b.status,
    b.chamber,
    b.category,
    b.simplified_text,
    b.weight_score,
    b.cosponsor_count,
    b.amendment_count,
    b.yea_count,
    b.nay_count,
    b.total_votes,
    b.projected_outcome,
    b.introduced_date,
    r.name as sponsor_name,
    r.party as sponsor_party,
    r.image_url as sponsor_image
  FROM bills b
  LEFT JOIN representatives r ON b.sponsor_id = r.id
  WHERE
    (p_category IS NULL OR b.category = p_category)
    AND b.weight_score >= p_min_weight
  ORDER BY b.weight_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_daily_bill_digest TO authenticated, anon;

-- ============================================
-- Initialize weight scores for existing bills
-- ============================================
UPDATE bills
SET
  weight_score = calculate_voice_weight(status, COALESCE(cosponsor_count, 0), COALESCE(amendment_count, 0)),
  weight_last_calculated = NOW();

-- ============================================
-- SCHEDULED JOB: Recalculate weights every 6 hours
-- Requires pg_cron extension (enabled by default on Supabase)
-- ============================================
-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the weight recalculation to run every 6 hours
-- Cron expression: minute hour day month weekday
-- '0 */6 * * *' = At minute 0 of every 6th hour
SELECT cron.schedule(
  'recalculate-bill-weights',
  '0 */6 * * *',
  $$SELECT * FROM recalculate_all_weight_scores()$$
);

-- To view scheduled jobs: SELECT * FROM cron.job;
-- To unschedule: SELECT cron.unschedule('recalculate-bill-weights');

-- ============================================
-- FUNCTION: Get vote breakdown by state
-- ============================================
CREATE OR REPLACE FUNCTION get_votes_by_state(
  p_bill_id UUID
)
RETURNS TABLE (
  state TEXT,
  yea_count BIGINT,
  nay_count BIGINT,
  total_count BIGINT,
  approval_pct NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.state,
    COUNT(*) FILTER (WHERE v.vote = 'yea') AS yea_count,
    COUNT(*) FILTER (WHERE v.vote = 'nay') AS nay_count,
    COUNT(*) AS total_count,
    ROUND(
      (COUNT(*) FILTER (WHERE v.vote = 'yea')::numeric / NULLIF(COUNT(*), 0)) * 100,
      1
    ) AS approval_pct
  FROM votes v
  JOIN profiles p ON v.user_id = p.id
  WHERE v.bill_id = p_bill_id
    AND p.state IS NOT NULL
  GROUP BY p.state
  ORDER BY total_count DESC;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_votes_by_state TO authenticated, anon;
