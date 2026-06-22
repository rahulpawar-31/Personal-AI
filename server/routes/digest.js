import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { digestLimiter } from '../middleware/rateLimiter.js';
import { runDigest, _digestCache } from '../lib/digest.js';

const router = Router();

router.post('/api/digest/run', requireAuth, digestLimiter, async (req, res) => {
  try {
    const digest = await runDigest(req.user.userId);
    res.json(digest);
  } catch (err) {
    console.error('[digest/run]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/digest/latest', requireAuth, (req, res) => {
  res.json(_digestCache.get(String(req.user.userId)) ?? null);
});

export default router;
