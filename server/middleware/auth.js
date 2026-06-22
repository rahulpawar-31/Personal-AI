import * as userService from '../services/users.js';
import { dbIsAdmin } from '../services/db.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = userService.verifyToken(header.slice(7));
    req.user = { userId: payload.userId, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = userService.verifyToken(header.slice(7));
    req.user = { userId: payload.userId, username: payload.username };
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const admin = await dbIsAdmin(req.user.userId);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}
