import { Router } from 'express';
import * as userService from '../services/users.js';
import * as integrations from '../services/integrations.js';
import auth from '../services/auth.js';
import { dbListUsers, dbDeleteUser, dbSetAdmin, getPool } from '../services/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { accountLimiter } from '../middleware/rateLimiter.js';
import { describeRequestPath } from '../lib/requestPath.js';

const router = Router();

// A removed account must stop feeding the background jobs (the 9 AM digest and
// the meeting-brief cron both pick users from the token files on disk), and
// must not leave Google access behind. `heldTokens` were read before the
// account was deleted, because its database rows go with it.
async function disconnectRemovedUser(userId, heldTokens = null) {
  try {
    await auth.revokeGoogleTokens(heldTokens);
    await auth.disconnectUser(userId);
  } catch (err) {
    console.warn(`[account] Could not clear connections for removed user ${userId}:`, err.message);
  }
}

router.put('/api/users/me/email', requireAuth, async (req, res) => {
  try {
    await userService.updateEmail(req.user.userId, req.body.email);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/users/me/role', requireAuth, async (req, res) => {
  try {
    await userService.updateRole(req.user.userId, req.body.role);
    res.json({ ok: true, role: req.body.role });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/users/me/password', requireAuth, accountLimiter, async (req, res) => {
  try {
    const updated = await userService.updatePassword(req.user.userId, req.body.currentPassword, req.body.newPassword);
    // Other sessions just ended; give this one a fresh cookie so it stays signed in.
    userService.setRefreshCookie(res, updated);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/users/me', requireAuth, accountLimiter, async (req, res) => {
  try {
    const held = await auth.readGoogleTokens(req.user.userId);
    await userService.deleteUser(req.user.userId, req.body.password);
    await disconnectRemovedUser(req.user.userId, held);
    userService.clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Admin ────────────────────────────────────────────────────────────────────

router.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await dbListUsers();
    const withCounts = await Promise.all(users.map(async u => {
      try {
        const keys = await integrations.listKeysWithMeta(u.id);
        return { ...u, integrationCount: integrations.countSavedKeys(keys), connectedServices: integrations.connectedServices(keys) };
      } catch {
        return { ...u, integrationCount: 0, connectedServices: [] };
      }
    }));
    res.json(withCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/users/:id/keys', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user ID' });
  try {
    const users = await dbListUsers();
    if (!users.some(u => u.id === targetId)) return res.status(404).json({ error: 'User not found' });
    res.json(integrations.describeKeys(await integrations.listKeysWithMeta(targetId)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// What the server sees of the caller's network path, and what each proxy-hop
// setting would pick as the client address (see the runbook, "Checking the
// client address"). Admin only; it reports the caller's own request.
router.get('/api/admin/network', requireAdmin, (req, res) => {
  res.json(describeRequestPath(req, Number(req.app.get('trust proxy'))));
});

// Secret rotation (see SECURITY-P0-P2-RUNBOOK.md). Counts only, never values.
router.get('/api/admin/encryption', requireAdmin, async (req, res) => {
  try {
    res.json(await integrations.encryptionStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/encryption/reencrypt', requireAdmin, async (req, res) => {
  try {
    const result = await integrations.reencryptAll();
    console.log(`[encryption] admin ${req.user.userId} re-encrypted ${result.reencrypted} of ${result.total} stored value(s); ${result.unreadable} unreadable, ${result.skippedChanged} changed meanwhile`);
    res.json({ ...result, status: await integrations.encryptionStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user ID' });
  if (targetId === req.user.userId) return res.status(400).json({ error: 'Cannot delete your own account here' });
  try {
    const held = await auth.readGoogleTokens(targetId);
    await dbDeleteUser(targetId);
    await disconnectRemovedUser(targetId, held);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/admin/users/:id/admin', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user ID' });
  if (!req.body.isAdmin && targetId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot remove your own admin access' });
  }
  try {
    await dbSetAdmin(targetId, Boolean(req.body.isAdmin));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const users = await dbListUsers();
    const pool  = getPool();
    let integrationRows = 0;
    if (pool) {
      const r = await pool.query('SELECT COUNT(*) FROM user_integrations');
      integrationRows = Number(r.rows[0].count);
    }
    res.json({
      userCount:       users.length,
      adminCount:      users.filter(u => u.isAdmin).length,
      integrationRows,
      uptime:          Math.floor(process.uptime()),
      nodeVersion:     process.version,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
