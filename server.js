const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { jwtVerify, createRemoteJWKSet } = require('jose');

const app = express();
const port = Number(process.env.PORT || 5000);
const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '';
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || '';
const clerkSecretKey = process.env.CLERK_SECRET_KEY || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminTokens = new Map();
let pool = null;
let dbReady = false;
let dbError = null;
let jwks = null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

if (databaseUrl) {
  pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('sslmode=') ? undefined : { rejectUnauthorized: false } });
}

function issuerFromPublishableKey() {
  if (process.env.CLERK_ISSUER) return process.env.CLERK_ISSUER.replace(/\/$/, '');
  if (!clerkPublishableKey) return '';
  const encoded = clerkPublishableKey.split('_').slice(2).join('_');
  try {
    return `https://${Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '')}`;
  } catch {
    return '';
  }
}

function requiredSetup() {
  const missing = [];
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (!clerkPublishableKey) missing.push('CLERK_PUBLISHABLE_KEY');
  if (!clerkSecretKey) missing.push('CLERK_SECRET_KEY');
  if (!adminPassword) missing.push('ADMIN_PASSWORD');
  return missing;
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

async function q(sql, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured in Secrets yet.');
  await initDb();
  return pool.query(sql, params);
}

async function initDb() {
  if (dbReady) return;
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        clerk_id TEXT UNIQUE,
        email TEXT,
        username TEXT,
        display_name TEXT,
        minecraft_username TEXT,
        bio TEXT,
        avatar_url TEXT,
        rank TEXT NOT NULL DEFAULT 'player',
        is_banned BOOLEAN NOT NULL DEFAULT FALSE,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        post_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'news',
        content TEXT NOT NULL,
        author_name TEXT NOT NULL DEFAULT 'Owner',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS rules (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS bans (
        id SERIAL PRIMARY KEY,
        player_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        duration TEXT NOT NULL DEFAULT 'Permanent',
        staff_name TEXT NOT NULL DEFAULT 'Owner',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS appeals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        player_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        explanation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        applicant_name TEXT NOT NULL,
        position TEXT NOT NULL,
        age TEXT NOT NULL,
        availability TEXT NOT NULL,
        experience TEXT,
        why_join TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        submitter_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        admin_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS forum_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS forum_threads (
        id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES forum_categories(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        is_locked BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS forum_posts (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER REFERENCES forum_threads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS store_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'rank',
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        description TEXT NOT NULL,
        features JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS gallery_images (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        image_url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS changelog (
        id SERIAL PRIMARY KEY,
        version TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS vote_sites (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS leaderboard (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        rank TEXT NOT NULL DEFAULT 'player',
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0,
        votes INTEGER NOT NULL DEFAULT 0,
        money NUMERIC(12,2) NOT NULL DEFAULT 0,
        playtime INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS display_name TEXT;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS minecraft_username TEXT;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS bio TEXT;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT 'player';
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS post_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS announcements ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE IF EXISTS announcements ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'news';
      ALTER TABLE IF EXISTS announcements ADD COLUMN IF NOT EXISTS content TEXT;
      ALTER TABLE IF EXISTS announcements ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT 'Owner';
      ALTER TABLE IF EXISTS announcements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS rules ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE IF EXISTS rules ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';
      ALTER TABLE IF EXISTS rules ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE IF EXISTS rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS bans ADD COLUMN IF NOT EXISTS player_name TEXT;
      ALTER TABLE IF EXISTS bans ADD COLUMN IF NOT EXISTS reason TEXT;
      ALTER TABLE IF EXISTS bans ADD COLUMN IF NOT EXISTS duration TEXT NOT NULL DEFAULT 'Permanent';
      ALTER TABLE IF EXISTS bans ADD COLUMN IF NOT EXISTS staff_name TEXT NOT NULL DEFAULT 'Owner';
      ALTER TABLE IF EXISTS bans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE IF EXISTS bans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS player_name TEXT;
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS reason TEXT;
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS explanation TEXT;
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS admin_note TEXT;
      ALTER TABLE IF EXISTS appeals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS applicant_name TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS position TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS age TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS availability TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS experience TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS why_join TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS admin_note TEXT;
      ALTER TABLE IF EXISTS applications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS submitter_name TEXT;
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS subject TEXT;
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS category TEXT;
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS message TEXT;
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS admin_note TEXT;
      ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS forum_categories ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE IF EXISTS forum_categories ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE IF EXISTS forum_categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS forum_threads ADD COLUMN IF NOT EXISTS category_id INTEGER;
      ALTER TABLE IF EXISTS forum_threads ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE IF EXISTS forum_threads ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE IF EXISTS forum_threads ADD COLUMN IF NOT EXISTS content TEXT;
      ALTER TABLE IF EXISTS forum_threads ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE IF EXISTS forum_threads ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS forum_posts ADD COLUMN IF NOT EXISTS thread_id INTEGER;
      ALTER TABLE IF EXISTS forum_posts ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE IF EXISTS forum_posts ADD COLUMN IF NOT EXISTS content TEXT;
      ALTER TABLE IF EXISTS forum_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS store_items ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE IF EXISTS store_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'rank';
      ALTER TABLE IF EXISTS store_items ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS store_items ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE IF EXISTS store_items ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]';
      ALTER TABLE IF EXISTS store_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS gallery_images ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE IF EXISTS gallery_images ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE IF EXISTS gallery_images ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE IF EXISTS gallery_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS changelog ADD COLUMN IF NOT EXISTS version TEXT;
      ALTER TABLE IF EXISTS changelog ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE IF EXISTS changelog ADD COLUMN IF NOT EXISTS content TEXT;
      ALTER TABLE IF EXISTS changelog ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS vote_sites ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE IF EXISTS vote_sites ADD COLUMN IF NOT EXISTS url TEXT;
      ALTER TABLE IF EXISTS vote_sites ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE IF EXISTS vote_sites ADD COLUMN IF NOT EXISTS reward TEXT NOT NULL DEFAULT 'Daily reward';
      ALTER TABLE IF EXISTS vote_sites ADD COLUMN IF NOT EXISTS cooldown_hours INTEGER NOT NULL DEFAULT 24;
      ALTER TABLE IF EXISTS vote_sites ALTER COLUMN reward SET DEFAULT 'Daily reward';
      ALTER TABLE IF EXISTS vote_sites ALTER COLUMN cooldown_hours SET DEFAULT 24;
      ALTER TABLE IF EXISTS vote_sites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS username TEXT;
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT 'player';
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS deaths INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS votes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS money NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS playtime INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE IF EXISTS leaderboard ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
    await pool.query(`
      DO $$ BEGIN
        -- Fix legacy clerk_user_id NOT NULL
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='clerk_user_id'
        ) THEN
          BEGIN ALTER TABLE users ALTER COLUMN clerk_user_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
          UPDATE users SET clerk_id = clerk_user_id WHERE clerk_id IS NULL AND clerk_user_id IS NOT NULL;
        END IF;
        -- Fix legacy users.username NOT NULL (migrate later-added clerk accounts safely)
        BEGIN ALTER TABLE users ALTER COLUMN username DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        -- Fix legacy forum_threads columns
        BEGIN ALTER TABLE forum_threads ALTER COLUMN author_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_threads ALTER COLUMN author_name DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_threads ALTER COLUMN author_name SET DEFAULT ''; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_threads ALTER COLUMN author_rank DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_threads ALTER COLUMN author_rank SET DEFAULT 'player'; EXCEPTION WHEN OTHERS THEN NULL; END;
        -- Fix legacy forum_posts columns
        BEGIN ALTER TABLE forum_posts ALTER COLUMN author_id DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_posts ALTER COLUMN author_name DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_posts ALTER COLUMN author_name SET DEFAULT ''; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_posts ALTER COLUMN author_rank DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE forum_posts ALTER COLUMN author_rank SET DEFAULT 'player'; EXCEPTION WHEN OTHERS THEN NULL; END;
        -- Ensure forum_threads has content and post_count
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forum_threads' AND column_name='content') THEN
          ALTER TABLE forum_threads ADD COLUMN content TEXT NOT NULL DEFAULT '';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='forum_threads' AND column_name='post_count') THEN
          ALTER TABLE forum_threads ADD COLUMN post_count INTEGER NOT NULL DEFAULT 0;
        END IF;
      END $$;
    `);
    await seedDb();
    dbReady = true;
    dbError = null;
  } catch (error) {
    dbError = error;
    throw error;
  }
}

async function seedDb() {
  const tables = ['announcements', 'rules', 'forum_categories', 'store_items', 'gallery_images', 'changelog', 'vote_sites', 'leaderboard'];
  const counts = await Promise.all(tables.map(t => pool.query(`SELECT COUNT(*)::int AS count FROM ${t}`)));
  if (counts[0].rows[0].count === 0) {
    await pool.query("INSERT INTO announcements (title, type, content, author_name) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)", ['Grand opening', 'event', 'The Vortex Network portal is live with accounts, forums, tickets, appeals, and admin tools.', 'Owner', 'Survival season update', 'news', 'Fresh economy, balanced crates, new events, and player rewards are ready.', 'Staff']);
  }
  if (counts[1].rows[0].count === 0) {
    await pool.query("INSERT INTO rules (title, category, description) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9)", ['Respect everyone', 'Community', 'No harassment, hate speech, spam, or threats.', 'No cheating', 'Gameplay', 'No hacked clients, exploits, duping, x-ray, or unfair mods.', 'Keep chat clean', 'Chat', 'Avoid flooding, advertising, and inappropriate content.']);
  }
  if (counts[2].rows[0].count === 0) {
    await pool.query("INSERT INTO forum_categories (name, description) VALUES ($1,$2),($3,$4),($5,$6)", ['Announcements', 'Official server news and updates.', 'General Discussion', 'Talk with the community.', 'Support', 'Ask questions and get staff help.']);
  }
  if (counts[3].rows[0].count === 0) {
    await pool.query("INSERT INTO store_items (name, category, price, description, features) VALUES ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)", ['VIP Rank', 'rank', 9.99, 'Starter supporter rank with cosmetic perks.', JSON.stringify(['VIP tag', 'Cosmetic crate keys', 'Extra homes']), 'MVP Rank', 'rank', 19.99, 'Premium rank for active players.', JSON.stringify(['MVP tag', 'Monthly keys', 'More auction slots']), 'Elite Crate Bundle', 'crates', 4.99, 'A bundle of reward crate keys.', JSON.stringify(['5 crate keys', 'Bonus coins'])]);
  }
  if (counts[4].rows[0].count === 0) {
    await pool.query("INSERT INTO gallery_images (title, image_url, description) VALUES ($1,$2,$3)", ['Spawn Preview', 'assets/img/opengraph.jpg', 'The official network portal preview.']);
  }
  if (counts[5].rows[0].count === 0) {
    await pool.query("INSERT INTO changelog (version, title, content) VALUES ($1,$2,$3)", ['1.0.0', 'Website rebuilt', 'Added real backend routes, database storage, auth-ready accounts, and admin management.']);
  }
  if (counts[6].rows[0].count === 0) {
    await pool.query("INSERT INTO vote_sites (name, url, description) VALUES ($1,$2,$3),($4,$5,$6)", ['Minecraft Server List', 'https://minecraftservers.org', 'Vote daily to support the server.', 'TopG', 'https://topg.org', 'Earn rewards after voting.']);
  }
  if (counts[7].rows[0].count === 0) {
    await pool.query("INSERT INTO leaderboard (username, rank, kills, deaths, votes, money, playtime) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14),($15,$16,$17,$18,$19,$20,$21)", ['VortexOwner', 'owner', 420, 22, 91, 250000, 980, 'VortexMVP', 'mvp', 190, 44, 58, 48000, 510, 'RedstonePro', 'elite', 120, 39, 33, 32000, 360]);
  }
}

function camelUser(row) {
  return { id: row.id, email: row.email, username: row.username, displayName: row.display_name, minecraftUsername: row.minecraft_username, bio: row.bio, avatarUrl: row.avatar_url, rank: row.rank, isBanned: row.is_banned, emailVerified: row.email_verified, postCount: row.post_count, joinedAt: row.created_at, isAdmin: ['owner', 'admin', 'moderator'].includes(row.rank) };
}

function adminUser() {
  return { id: 0, email: 'owner@local.admin', username: 'owner', displayName: 'Owner Admin', minecraftUsername: '', bio: '', avatarUrl: '', rank: 'owner', isBanned: false, emailVerified: true, postCount: 0, joinedAt: new Date().toISOString(), isAdmin: true };
}

function cleanToken(token) {
  return String(token || '').trim();
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getAdminToken(req) {
  return cleanToken(req.get('x-admin-token'));
}

function isAdminTokenValid(req) {
  const token = getAdminToken(req);
  const expires = adminTokens.get(token);
  if (!token || !expires) return false;
  if (expires < Date.now()) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

async function clerkUserFromRequest(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const issuer = issuerFromPublishableKey();
  if (!issuer) throw new Error('CLERK_PUBLISHABLE_KEY is not configured in Secrets yet.');
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const verified = await jwtVerify(token, jwks, { issuer });
  const clerkId = verified.payload.sub;
  let profile = null;
  if (clerkSecretKey) {
    const response = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, { headers: { Authorization: `Bearer ${clerkSecretKey}` } });
    if (response.ok) profile = await response.json();
  }
  const primaryEmailId = profile?.primary_email_address_id;
  const primaryEmail = profile?.email_addresses?.find(e => e.id === primaryEmailId) || profile?.email_addresses?.[0] || null;
  const email = primaryEmail?.email_address || verified.payload.email || '';
  const emailVerified = primaryEmail?.verification?.status === 'verified' || verified.payload.email_verified !== false;
  const username = profile?.username || email.split('@')[0] || `player_${String(clerkId).slice(-6)}`;
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || username;
  const avatarUrl = profile?.image_url || '';
  const existing = await q('SELECT * FROM users WHERE clerk_id=$1', [clerkId]);
  if (existing.rows[0]) {
    const updated = await q('UPDATE users SET email=$2, username=$3, display_name=COALESCE(NULLIF(display_name, $4), $5), avatar_url=$6, email_verified=$7 WHERE clerk_id=$1 RETURNING *', [clerkId, email, username, existing.rows[0].display_name || '', displayName, avatarUrl, emailVerified]);
    return camelUser(updated.rows[0]);
  }
  const inserted = await q('INSERT INTO users (clerk_id, email, username, display_name, avatar_url, email_verified) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [clerkId, email, username, displayName, avatarUrl, emailVerified]);
  return camelUser(inserted.rows[0]);
}

async function getUser(req) {
  if (isAdminTokenValid(req)) return adminUser();
  return clerkUserFromRequest(req);
}

async function requireUser(req, res) {
  const user = await getUser(req);
  if (!user) {
    sendError(res, 401, 'Please sign in first.');
    return null;
  }
  if (!user.emailVerified) {
    sendError(res, 403, 'Please verify your email before using this feature.');
    return null;
  }
  if (user.isBanned) {
    sendError(res, 403, 'This account is banned.');
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await getUser(req);
  if (!user || !user.isAdmin) {
    sendError(res, 403, 'Owner or staff access required.');
    return null;
  }
  return user;
}

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch(error => sendError(res, 500, error.message));
}

function parseFeatures(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split('\n').map(v => v.trim()).filter(Boolean);
}

function mapRows(rows, type) {
  return rows.map(row => {
    if (type === 'announcements') return { id: row.id, title: row.title, type: row.type, content: row.content, authorName: row.author_name, createdAt: row.created_at };
    if (type === 'rules') return { id: row.id, title: row.title, category: row.category, description: row.description, createdAt: row.created_at };
    if (type === 'bans') return { id: row.id, playerName: row.player_name, reason: row.reason, duration: row.duration, staffName: row.staff_name, status: row.status, createdAt: row.created_at };
    if (type === 'appeals') return { id: row.id, playerName: row.player_name, reason: row.reason, explanation: row.explanation, status: row.status, adminNote: row.admin_note, createdAt: row.created_at };
    if (type === 'applications') return { id: row.id, applicantName: row.applicant_name, position: row.position, age: row.age, availability: row.availability, experience: row.experience, whyJoin: row.why_join, status: row.status, adminNote: row.admin_note, createdAt: row.created_at };
    if (type === 'tickets') return { id: row.id, submitterName: row.submitter_name, subject: row.subject, category: row.category, message: row.message, status: row.status, adminNote: row.admin_note, createdAt: row.created_at };
    if (type === 'categories') return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at };
    if (type === 'threads') return { id: row.id, categoryId: row.category_id, title: row.title, content: row.content, authorName: row.author_name, isLocked: row.is_locked, postCount: row.post_count, createdAt: row.created_at };
    if (type === 'posts') return { id: row.id, content: row.content, authorName: row.author_name, createdAt: row.created_at };
    if (type === 'store') return { id: row.id, name: row.name, category: row.category, price: Number(row.price), description: row.description, features: row.features || [], createdAt: row.created_at };
    if (type === 'gallery') return { id: row.id, title: row.title, imageUrl: row.image_url, description: row.description, createdAt: row.created_at };
    if (type === 'changelog') return { id: row.id, version: row.version, title: row.title, content: row.content, createdAt: row.created_at };
    if (type === 'votes') return { id: row.id, name: row.name, url: row.url, description: row.description, createdAt: row.created_at };
    if (type === 'leaderboard') return { id: row.id, username: row.username, rank: row.rank, kills: row.kills, deaths: row.deaths, votes: row.votes, money: Number(row.money), playtime: row.playtime, createdAt: row.created_at };
    return row;
  });
}

app.get('/api/config', (req, res) => {
  res.json({ clerkPublishableKey, clerkIssuer: issuerFromPublishableKey(), setupRequired: requiredSetup() });
});

app.post('/api/admin/login', (req, res) => {
  if (!adminPassword) return sendError(res, 503, 'ADMIN_PASSWORD is not configured in Secrets yet.');
  if (!secureEqual(req.body.password, adminPassword)) return sendError(res, 401, 'Wrong owner password.');
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + 1000 * 60 * 60 * 12);
  res.json({ token, expiresInHours: 12 });
});

app.post('/api/admin/logout', (req, res) => {
  adminTokens.delete(getAdminToken(req));
  res.json({ ok: true });
});

app.get('/api/server/status', (req, res) => res.json({ online: true, playerCount: 37, maxPlayers: 100, version: '1.21.4', motd: 'Welcome to Vortex Network - accounts, community, store, and staff tools are live.' }));

app.get('/api/server/stats', asyncRoute(async (req, res) => {
  const users = await q('SELECT COUNT(*)::int AS count FROM users');
  const votes = await q('SELECT COUNT(*)::int AS count FROM vote_sites');
  const peak = await q('SELECT COALESCE(MAX(kills), 87)::int AS peak FROM leaderboard');
  res.json({ totalPlayers: users.rows[0].count, totalVotes: votes.rows[0].count, uptime: '99.9%', peakPlayers: Math.max(87, peak.rows[0].peak) });
}));

app.get('/api/users/profile', asyncRoute(async (req, res) => {
  const user = await getUser(req);
  if (!user) return sendError(res, 401, 'Please sign in first.');
  res.json(user);
}));

app.put('/api/users/profile', asyncRoute(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.id === 0) return res.json(user);
  const updated = await q('UPDATE users SET display_name=$2, minecraft_username=$3, bio=$4 WHERE id=$1 RETURNING *', [user.id, req.body.displayName || user.displayName, req.body.minecraftUsername || '', req.body.bio || '']);
  res.json(camelUser(updated.rows[0]));
}));

app.get('/api/users', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('SELECT * FROM users ORDER BY created_at DESC');
  res.json({ users: rows.rows.map(camelUser) });
}));

app.post('/api/users/:id/promote', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('UPDATE users SET rank=$2 WHERE id=$1 RETURNING *', [req.params.id, req.body.rank || 'player']);
  res.json(camelUser(rows.rows[0]));
}));

app.post('/api/users/:id/ban', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('UPDATE users SET is_banned=TRUE WHERE id=$1 RETURNING *', [req.params.id]);
  res.json(camelUser(rows.rows[0]));
}));

app.post('/api/users/:id/unban', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('UPDATE users SET is_banned=FALSE WHERE id=$1 RETURNING *', [req.params.id]);
  res.json(camelUser(rows.rows[0]));
}));

app.get('/api/admin/stats', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const names = ['users', 'bans', 'appeals', 'applications', 'tickets', 'forum_threads', 'store_items', 'announcements'];
  const result = {};
  for (const name of names) {
    const count = await q(`SELECT COUNT(*)::int AS count FROM ${name}`);
    result[name.replace('forum_threads', 'threads').replace('store_items', 'store')] = count.rows[0].count;
  }
  res.json(result);
}));

app.get('/api/announcements', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 50);
  const rows = await q('SELECT * FROM announcements ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ announcements: mapRows(rows.rows, 'announcements') });
}));

app.post('/api/announcements', asyncRoute(async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const rows = await q('INSERT INTO announcements (title,type,content,author_name) VALUES ($1,$2,$3,$4) RETURNING *', [req.body.title, req.body.type || 'news', req.body.content, user.displayName || 'Owner']);
  res.json(mapRows(rows.rows, 'announcements')[0]);
}));

app.get('/api/rules', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM rules ORDER BY id');
  res.json({ rules: mapRows(rows.rows, 'rules') });
}));

app.post('/api/rules', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO rules (title,category,description) VALUES ($1,$2,$3) RETURNING *', [req.body.title, req.body.category || 'General', req.body.description]);
  res.json(mapRows(rows.rows, 'rules')[0]);
}));

app.get('/api/bans', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM bans ORDER BY created_at DESC');
  res.json({ bans: mapRows(rows.rows, 'bans') });
}));

app.post('/api/bans', asyncRoute(async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const rows = await q('INSERT INTO bans (player_name, reason, duration, staff_name) VALUES ($1,$2,$3,$4) RETURNING *', [req.body.playerName, req.body.reason, req.body.duration || 'Permanent', user.displayName || 'Owner']);
  res.json(mapRows(rows.rows, 'bans')[0]);
}));

app.post('/api/bans/:id/unban', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q("UPDATE bans SET status='expired' WHERE id=$1 RETURNING *", [req.params.id]);
  res.json(mapRows(rows.rows, 'bans')[0]);
}));

app.get('/api/appeals', asyncRoute(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.json({ appeals: [] });
  const rows = user.isAdmin ? await q('SELECT * FROM appeals ORDER BY created_at DESC') : await q('SELECT * FROM appeals WHERE user_id=$1 ORDER BY created_at DESC', [user.id]);
  res.json({ appeals: mapRows(rows.rows, 'appeals') });
}));

app.post('/api/appeals', asyncRoute(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const rows = await q('INSERT INTO appeals (user_id, player_name, reason, explanation) VALUES ($1,$2,$3,$4) RETURNING *', [user.id > 0 ? user.id : null, req.body.playerName, req.body.reason, req.body.explanation]);
  res.json(mapRows(rows.rows, 'appeals')[0]);
}));

app.post('/api/appeals/:id/review', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('UPDATE appeals SET status=$2, admin_note=$3 WHERE id=$1 RETURNING *', [req.params.id, req.body.status, req.body.adminNote || '']);
  res.json(mapRows(rows.rows, 'appeals')[0]);
}));

app.get('/api/applications', asyncRoute(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.json({ applications: [] });
  const rows = user.isAdmin ? await q('SELECT * FROM applications ORDER BY created_at DESC') : await q('SELECT * FROM applications WHERE user_id=$1 ORDER BY created_at DESC', [user.id]);
  res.json({ applications: mapRows(rows.rows, 'applications') });
}));

app.post('/api/applications', asyncRoute(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const rows = await q('INSERT INTO applications (user_id, applicant_name, position, age, availability, experience, why_join) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [user.id > 0 ? user.id : null, req.body.applicantName, req.body.position, req.body.age, req.body.availability, req.body.experience || '', req.body.whyJoin || '']);
  res.json(mapRows(rows.rows, 'applications')[0]);
}));

app.post('/api/applications/:id/review', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('UPDATE applications SET status=$2, admin_note=$3 WHERE id=$1 RETURNING *', [req.params.id, req.body.status, req.body.adminNote || '']);
  res.json(mapRows(rows.rows, 'applications')[0]);
}));

app.get('/api/tickets', asyncRoute(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.json({ tickets: [] });
  const rows = user.isAdmin ? await q('SELECT * FROM tickets ORDER BY created_at DESC') : await q('SELECT * FROM tickets WHERE user_id=$1 ORDER BY created_at DESC', [user.id]);
  res.json({ tickets: mapRows(rows.rows, 'tickets') });
}));

app.post('/api/tickets', asyncRoute(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const rows = await q('INSERT INTO tickets (user_id, submitter_name, subject, category, message) VALUES ($1,$2,$3,$4,$5) RETURNING *', [user.id > 0 ? user.id : null, req.body.submitterName || user.displayName, req.body.subject, req.body.category, req.body.message]);
  res.json(mapRows(rows.rows, 'tickets')[0]);
}));

app.post('/api/tickets/:id/review', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('UPDATE tickets SET status=$2, admin_note=$3 WHERE id=$1 RETURNING *', [req.params.id, req.body.status, req.body.adminNote || '']);
  res.json(mapRows(rows.rows, 'tickets')[0]);
}));

app.get('/api/forums/stats', asyncRoute(async (req, res) => {
  const threads = await q('SELECT COUNT(*)::int AS count FROM forum_threads');
  const posts = await q('SELECT COUNT(*)::int AS count FROM forum_posts');
  const members = await q('SELECT COUNT(*)::int AS count FROM users');
  res.json({ totalThreads: threads.rows[0].count, totalPosts: posts.rows[0].count, totalMembers: members.rows[0].count });
}));

app.get('/api/forums/categories', asyncRoute(async (req, res) => {
  const rows = await q('SELECT c.*, COUNT(DISTINCT t.id)::int AS thread_count, (COUNT(p.id) + COUNT(DISTINCT t.id))::int AS post_count FROM forum_categories c LEFT JOIN forum_threads t ON t.category_id=c.id LEFT JOIN forum_posts p ON p.thread_id=t.id GROUP BY c.id ORDER BY c.id');
  res.json({ categories: rows.rows.map(r => ({ id: r.id, name: r.name, description: r.description, threadCount: r.thread_count, postCount: r.post_count, createdAt: r.created_at })) });
}));

app.post('/api/forums/categories', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO forum_categories (name,description) VALUES ($1,$2) RETURNING *', [req.body.name, req.body.description]);
  res.json(mapRows(rows.rows, 'categories')[0]);
}));

app.get('/api/forums/categories/:id/threads', asyncRoute(async (req, res) => {
  const rows = await q('SELECT t.*, COALESCE(u.display_name, u.username, $2) AS author_name, COUNT(p.id)::int AS post_count FROM forum_threads t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN forum_posts p ON p.thread_id=t.id WHERE t.category_id=$1 GROUP BY t.id, u.display_name, u.username ORDER BY t.created_at DESC', [req.params.id, 'Player']);
  res.json({ threads: mapRows(rows.rows, 'threads') });
}));

app.post('/api/forums/threads', asyncRoute(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const uid = user.id > 0 ? user.id : null;
  const rows = await q('INSERT INTO forum_threads (category_id,user_id,title,content) VALUES ($1,$2,$3,$4) RETURNING *', [req.body.categoryId, uid, req.body.title, req.body.content]);
  if (uid) await q('UPDATE users SET post_count=post_count+1 WHERE id=$1', [uid]);
  res.json({ id: rows.rows[0].id });
}));

app.get('/api/forums/threads/:id', asyncRoute(async (req, res) => {
  const thread = await q('SELECT t.*, COALESCE(u.display_name, u.username, $2) AS author_name FROM forum_threads t LEFT JOIN users u ON u.id=t.user_id WHERE t.id=$1', [req.params.id, 'Player']);
  if (!thread.rows[0]) return sendError(res, 404, 'Thread not found.');
  const posts = await q('SELECT p.*, COALESCE(u.display_name, u.username, $2) AS author_name FROM forum_posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.thread_id=$1 ORDER BY p.created_at', [req.params.id, 'Player']);
  res.json({ thread: mapRows(thread.rows, 'threads')[0], posts: mapRows(posts.rows, 'posts') });
}));

app.post('/api/forums/threads/:id/posts', asyncRoute(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const uid = user.id > 0 ? user.id : null;
  const rows = await q('INSERT INTO forum_posts (thread_id,user_id,content) VALUES ($1,$2,$3) RETURNING *', [req.params.id, uid, req.body.content]);
  if (uid) await q('UPDATE users SET post_count=post_count+1 WHERE id=$1', [uid]);
  res.json(mapRows(rows.rows, 'posts')[0]);
}));

app.get('/api/store', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM store_items ORDER BY price, id');
  res.json({ items: mapRows(rows.rows, 'store') });
}));

app.post('/api/store', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO store_items (name,category,price,description,features) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.body.name, req.body.category || 'rank', req.body.price || 0, req.body.description, JSON.stringify(parseFeatures(req.body.features))]);
  res.json(mapRows(rows.rows, 'store')[0]);
}));

app.get('/api/gallery', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM gallery_images ORDER BY created_at DESC');
  res.json({ images: mapRows(rows.rows, 'gallery') });
}));

app.post('/api/gallery', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO gallery_images (title,image_url,description) VALUES ($1,$2,$3) RETURNING *', [req.body.title, req.body.imageUrl, req.body.description || '']);
  res.json(mapRows(rows.rows, 'gallery')[0]);
}));

app.get('/api/changelog', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM changelog ORDER BY created_at DESC');
  res.json({ changelogs: mapRows(rows.rows, 'changelog') });
}));

app.post('/api/changelog', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO changelog (version,title,content) VALUES ($1,$2,$3) RETURNING *', [req.body.version, req.body.title, req.body.content]);
  res.json(mapRows(rows.rows, 'changelog')[0]);
}));

app.get('/api/votes', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM vote_sites ORDER BY id');
  res.json({ votes: mapRows(rows.rows, 'votes') });
}));

app.post('/api/votes', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO vote_sites (name,url,description) VALUES ($1,$2,$3) RETURNING *', [req.body.name, req.body.url, req.body.description || '']);
  res.json(mapRows(rows.rows, 'votes')[0]);
}));

app.get('/api/leaderboard', asyncRoute(async (req, res) => {
  const rows = await q('SELECT * FROM leaderboard ORDER BY kills DESC, votes DESC');
  res.json({ leaderboard: mapRows(rows.rows, 'leaderboard') });
}));

app.post('/api/leaderboard', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await q('INSERT INTO leaderboard (username,rank,kills,deaths,votes,money,playtime) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.body.username, req.body.rank || 'player', req.body.kills || 0, req.body.deaths || 0, req.body.votes || 0, req.body.money || 0, req.body.playtime || 0]);
  res.json(mapRows(rows.rows, 'leaderboard')[0]);
}));

const tableConfig = {
  bans: { table: 'bans', fields: ['player_name', 'reason', 'duration', 'status'] },
  forums: { table: 'forum_categories', fields: ['name', 'description'] },
  rules: { table: 'rules', fields: ['title', 'category', 'description'] },
  store: { table: 'store_items', fields: ['name', 'category', 'price', 'description', 'features'] },
  gallery: { table: 'gallery_images', fields: ['title', 'image_url', 'description'] },
  changelog: { table: 'changelog', fields: ['version', 'title', 'content'] },
  announcements: { table: 'announcements', fields: ['title', 'type', 'content'] },
  votes: { table: 'vote_sites', fields: ['name', 'url', 'description'] },
  leaderboard: { table: 'leaderboard', fields: ['username', 'rank', 'kills', 'deaths', 'votes', 'money', 'playtime'] },
  appeals: { table: 'appeals', fields: ['player_name', 'reason', 'explanation', 'status', 'admin_note'] },
  applications: { table: 'applications', fields: ['applicant_name', 'position', 'age', 'availability', 'experience', 'why_join', 'status', 'admin_note'] },
  tickets: { table: 'tickets', fields: ['submitter_name', 'subject', 'category', 'message', 'status', 'admin_note'] }
};

function bodyToColumnValue(type, column, body) {
  const key = column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (column === 'features') {
    if (body.features === undefined && body[key] === undefined) return undefined;
    return JSON.stringify(parseFeatures(body.features ?? body[key]));
  }
  return body[key] ?? body[column];
}

app.patch('/api/admin/records/:type/:id', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const config = tableConfig[req.params.type];
  if (!config) return sendError(res, 404, 'Unknown record type.');
  const updates = [];
  const values = [];
  for (const column of config.fields) {
    const value = bodyToColumnValue(req.params.type, column, req.body);
    if (value !== undefined) {
      values.push(value);
      updates.push(`${column}=$${values.length}`);
    }
  }
  if (!updates.length) return sendError(res, 400, 'No fields to update.');
  values.push(req.params.id);
  const rows = await q(`UPDATE ${config.table} SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`, values);
  res.json(rows.rows[0] || {});
}));

app.delete('/api/admin/records/:type/:id', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const config = tableConfig[req.params.type];
  if (!config) return sendError(res, 404, 'Unknown record type.');
  await q(`DELETE FROM ${config.table} WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/records/:id', asyncRoute(async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const tables = Object.values(tableConfig).map(v => v.table);
  for (const table of tables) await q(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb().catch(error => {
  dbError = error;
  console.error('Database setup failed:', error.message);
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    const missing = requiredSetup();
    console.log(`Website running on port ${port}`);
    if (missing.length) console.log(`Missing secure settings: ${missing.join(', ')}`);
    if (dbError) console.log(`Database error: ${dbError.message}`);
  });
}

module.exports = app;
