import { Router } from 'express';
import github   from '../services/github.js';
import llm      from '../services/llm.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserCreds } from '../lib/creds.js';

const router = Router();

router.get('/api/github/repos', requireAuth, async (req, res) => {
  const creds = await getUserCreds(req.user.userId);
  res.json(github.getRepos(creds));
});

router.get('/api/prs', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    res.json(await github.getOpenPRs(req.query.repo, creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/github/issues', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    res.json(await github.getIssues('open', req.query.repo, creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/github/issues', requireAuth, async (req, res) => {
  try {
    const { title, body = '', labels = [], repo } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const creds = await getUserCreds(req.user.userId);
    res.json(await github.createIssue(title.trim(), body, labels, repo, creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/github/merged', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    res.json(await github.getMergedPRs(undefined, req.query.repo, creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/github/changelog', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    const changelog = await github.generateChangelog(undefined, req.query.repo, creds);
    res.json({ changelog });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/github/draft-body', requireAuth, async (req, res) => {
  try {
    const { title, context = '' } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const creds   = await getUserCreds(req.user.userId);
    const apiKeys = { GEMINI_API_KEY: creds.GEMINI_API_KEY, GROQ_API_KEY: creds.GROQ_API_KEY };
    const body = await llm.generate(
      `Draft a GitHub issue body in markdown for the issue titled: "${title.trim()}". ` +
      `${context.trim() ? `Additional context: ${context.trim()} ` : ''}` +
      `Structure it with sections: ## Summary, ## Goals, ## Suggested approach, ## Tests (if applicable). ` +
      `Use bullet points. Be specific. Output only the markdown body, no preamble.`,
      '', 'content', apiKeys
    );
    res.json({ body });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/github/contributions', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    res.json(await github.getContributions(req.query.repo, creds) ?? {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/github/branches', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    res.json(await github.getBranches(req.query.repo, creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
