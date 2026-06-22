import { Router } from 'express';
import * as userService from '../services/users.js';
import * as integrations from '../services/integrations.js';
import { dbListUsers, dbDeleteUser, dbSetAdmin, getPool } from '../services/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.put('/api/users/me/email', requireAuth, async (req, res) => {
  try {
    await userService.updateEmail(req.user.userId, req.body.email);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/users/me/password', requireAuth, async (req, res) => {
  try {
    await userService.updatePassword(req.user.userId, req.body.currentPassword, req.body.newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/users/me', requireAuth, async (req, res) => {
  try {
    await userService.deleteUser(req.user.userId, req.body.password);
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
        return { ...u, integrationCount: keys.length };
      } catch {
        return { ...u, integrationCount: 0 };
      }
    }));
    res.json(withCounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid user ID' });
  if (targetId === req.user.userId) return res.status(400).json({ error: 'Cannot delete your own account here' });
  try {
    await dbDeleteUser(targetId);
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
    await dbSetAdmin(targetId, !!req.body.isAdmin);
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
