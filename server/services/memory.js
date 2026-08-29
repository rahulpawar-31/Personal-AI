// server/services/memory.js
// Per-user persistent memory — Postgres (user_memory table) with JSON file fallback.
// All exported functions take userId as the first argument.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MEMORY = {
  vipContacts:       [],
  facts:             [],
  voiceProfile: {
    tone:            'professional but friendly',
    sentenceLength:  'medium',
    openingStyle:    'direct',
    avoidPhrases:    [],
    approvedDrafts:  [],
  },
  projectPriorities: [],
  preferences: {
    workingHours:    { start: 9, end: 18 },
    digestTime:      '09:00',
    focusBlockMin:   90,
    stalenessThresholdPR:    3,
    stalenessThresholdCard:  5,
    maxLinkedInPostsPerWeek: 3,
  },
  activityLog: [],
};

// In-process cache: Map<userId, {data, dirty}>
const _cache = new Map();

function jsonPath(userId) {
  return path.join(__dirname, '..', `memory_${userId}.json`);
}

function legacyJsonPath() {
  return path.join(__dirname, '..', 'memory.json');
}

function mergeWithDefaults(stored) {
  const result = { ...DEFAULT_MEMORY, ...stored };
  // Deep-merge nested objects so new default fields aren't dropped for existing users
  if (stored.voiceProfile && typeof stored.voiceProfile === 'object') {
    result.voiceProfile = { ...DEFAULT_MEMORY.voiceProfile, ...stored.voiceProfile };
  }
  if (stored.preferences && typeof stored.preferences === 'object') {
    result.preferences = { ...DEFAULT_MEMORY.preferences, ...stored.preferences };
  }
  return result;
}

function readFromDisk(userId) {
  const perUser = jsonPath(userId);
  if (fs.existsSync(perUser)) {
    // Corrupt/unreadable file — fall through to the next fallback tier below.
    try { return mergeWithDefaults(JSON.parse(fs.readFileSync(perUser, 'utf8'))); } catch { /* fall through */ }
  }
  // First user (id=1) may have data in the old global memory.json
  if (userId === 1 || userId === '1') {
    const legacy = legacyJsonPath();
    if (fs.existsSync(legacy)) {
      // Corrupt/unreadable legacy file — fall through to defaults below.
      try { return mergeWithDefaults(JSON.parse(fs.readFileSync(legacy, 'utf8'))); } catch { /* fall through */ }
    }
  }
  return { ...DEFAULT_MEMORY };
}

function writeToDisk(userId, data) {
  // Best-effort local cache write — DB (saveToDB) is the source of truth, so a
  // failure here (e.g. read-only filesystem) is not fatal.
  try { fs.writeFileSync(jsonPath(userId), JSON.stringify(data, null, 2)); } catch { /* best-effort cache */ }
}

async function loadFromDB(userId) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const r = await pool.query('SELECT data FROM user_memory WHERE user_id = $1', [userId]);
    if (r.rows[0]) return mergeWithDefaults(r.rows[0].data);
  } catch { /* DB unavailable — caller falls back to disk */ }
  return null;
}

async function saveToDB(userId, data) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO user_memory (user_id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = NOW()`,
    [userId, JSON.stringify(data)]
  );
}

async function load(userId) {
  if (_cache.has(userId)) return _cache.get(userId);
  const fromDB = await loadFromDB(userId);
  const data   = fromDB ?? readFromDisk(userId);
  _cache.set(userId, data);
  return data;
}

async function save(userId, data) {
  _cache.set(userId, data);
  try {
    await saveToDB(userId, data); // throws on DB failure — callers surface the error
  } catch (err) {
    // Callers (addVIP, updatePreferences, etc.) mutate the cached object in
    // place before calling save(), so it may already reflect this change
    // even though the DB write just failed. Evict it so the next read goes
    // back to the DB/disk instead of silently serving unpersisted data.
    _cache.delete(userId);
    throw err;
  }
  writeToDisk(userId, data);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getMemory(userId) {
  return load(userId);
}

export async function addVIP(userId, email, name = '') {
  const mem = await load(userId);
  if (!mem.vipContacts.find(v => v.email === email)) {
    mem.vipContacts.push({ email, name, addedAt: new Date().toISOString() });
    await save(userId, mem);
  }
  return mem.vipContacts;
}

export async function removeVIP(userId, email) {
  const mem = await load(userId);
  mem.vipContacts = mem.vipContacts.filter(v => v.email !== email);
  await save(userId, mem);
  return mem.vipContacts;
}

export async function recordApprovedDraft(userId, original, edited, type = 'email') {
  const mem = await load(userId);
  mem.voiceProfile.approvedDrafts.push({
    type,
    original: original.slice(0, 300),
    edited:   edited.slice(0, 300),
    at:       new Date().toISOString(),
  });
  if (mem.voiceProfile.approvedDrafts.length > 50)
    mem.voiceProfile.approvedDrafts = mem.voiceProfile.approvedDrafts.slice(-50);
  await save(userId, mem);
}

export async function setProjectPriorities(userId, priorities = []) {
  const mem = await load(userId);
  mem.projectPriorities = priorities;
  await save(userId, mem);
  return priorities;
}

export async function updatePreferences(userId, prefs = {}) {
  const mem = await load(userId);
  mem.preferences = { ...mem.preferences, ...prefs };
  await save(userId, mem);
  return mem.preferences;
}

export async function saveFact(userId, key, value) {
  const mem = await load(userId);
  if (!mem.facts) mem.facts = [];
  const idx   = mem.facts.findIndex(f => f.key.toLowerCase() === key.toLowerCase());
  const entry = { key, value, savedAt: new Date().toISOString() };
  if (idx >= 0) mem.facts[idx] = entry;
  else mem.facts.push(entry);
  if (mem.facts.length > 100) mem.facts = mem.facts.slice(-100);
  await save(userId, mem);
  return mem.facts;
}

export async function buildContextSummary(userId) {
  const mem   = await load(userId);
  const lines = [];
  if (mem.facts?.length) {
    const factList = mem.facts.map(f => `${f.key}=${f.value}`).join('; ');
    lines.push(`Facts: ${factList}`);
  }
  if (mem.vipContacts?.length)       lines.push(`VIPs: ${mem.vipContacts.map(v => v.email).join(', ')}`);
  if (mem.projectPriorities?.length) lines.push(`Priorities: ${mem.projectPriorities.join(', ')}`);
  return lines.join(' | ');
}

export async function isVIP(userId, emailAddress) {
  const mem = await load(userId);
  return mem.vipContacts.some(v =>
    emailAddress.toLowerCase().includes(v.email.toLowerCase())
  );
}

export async function logActivity(userId, intent, params = {}, status = 'success', error = null) {
  try {
    const mem = await load(userId);
    if (!mem.activityLog) mem.activityLog = [];

    const { title, to, repo, date, days, time, startDate, endDate } = params;
    const slim = Object.fromEntries(
      Object.entries({ title, to, repo, date, days, time, startDate, endDate })
        .filter(([, v]) => v !== null && v !== undefined)
    );

    mem.activityLog.push({
      at:     new Date().toISOString(),
      intent,
      params: slim,
      status,
      ...(error ? { error } : {}),
    });

    if (mem.activityLog.length > 500) mem.activityLog = mem.activityLog.slice(-500);
    await save(userId, mem);
  } catch (err) {
    console.error('[memory] logActivity failed:', err.message);
  }
}

export async function getActivityLog(userId, limit = 50) {
  const mem = await load(userId);
  return (mem.activityLog ?? []).slice(-limit).reverse();
}

export default {
  getMemory,
  addVIP,
  removeVIP,
  recordApprovedDraft,
  setProjectPriorities,
  updatePreferences,
  isVIP,
  saveFact,
  buildContextSummary,
  logActivity,
  getActivityLog,
};
