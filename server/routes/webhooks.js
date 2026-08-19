import { Router } from 'express';
import crypto from 'crypto';
import auth   from '../services/auth.js';
import slack  from '../services/slack.js';
import github from '../services/github.js';
import { getUserCreds } from '../lib/creds.js';
import { publicOrigin } from '../lib/env.js';

const router = Router();

// Find the connected user who actually owns `repoFullName` (via their stored
// GITHUB_OWNER/GITHUB_REPO/GITHUB_REPOS) and has Slack configured. Returns
// null — rather than guessing at some other connected user — if no owner matches.
async function findOwnerCreds(repoFullName) {
  if (!repoFullName) return null;
  const target = repoFullName.toLowerCase();
  for (const uid of auth.getConnectedUserIds()) {
    const c = await getUserCreds(Number(uid));
    if (!c.SLACK_BOT_TOKEN || !c.SLACK_USER_ID) continue;
    const repos = github.getRepos(c).map(r => r.toLowerCase());
    if (repos.includes(target)) return c;
  }
  return null;
}

router.get('/api/webhook/info', (req, res) => {
  const base = publicOrigin() ?? `http://localhost:${process.env.PORT ?? 3001}`;
  res.json({ url: `${base}/api/webhook/github`, secret: !!process.env.GITHUB_WEBHOOK_SECRET });
});

router.post('/api/webhook/github', async (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Webhook not configured — set GITHUB_WEBHOOK_SECRET to enable.' });
  }
  const sig      = req.headers['x-hub-signature-256'] ?? '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  const sigBuf   = Buffer.from(sig);
  const expBuf   = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  res.json({ ok: true });

  const event = req.headers['x-github-event'];
  const body  = req.body;

  try {
    const creds = await findOwnerCreds(body.repository?.full_name);
    if (!creds) {
      console.log(`[webhook/github] no connected owner found for repo "${body.repository?.full_name ?? 'unknown'}" — skipping delivery`);
      return;
    }

    if (event === 'pull_request') {
      const pr     = body.pull_request;
      const repo   = body.repository?.full_name ?? '';
      const author = pr.user?.login ?? 'unknown';
      const url    = pr.html_url ?? '';
      const title  = pr.title ?? 'Untitled PR';
      const num    = pr.number;

      if (body.action === 'opened') {
        await slack.sendDM(`:arrow_heading_up: *New PR opened* in \`${repo}\`\n*#${num} — ${title}*\nBy: @${author}\n${url}`, creds);
      } else if (body.action === 'closed' && pr.merged) {
        await slack.sendDM(`:merged: *PR merged* in \`${repo}\`\n*#${num} — ${title}*\nMerged by: @${body.sender?.login ?? author}\n${url}`, creds);
      } else if (body.action === 'closed' && !pr.merged) {
        await slack.sendDM(`:x: *PR closed (unmerged)* in \`${repo}\`\n*#${num} — ${title}*\n${url}`, creds);
      } else if (body.action === 'review_requested') {
        const reviewer = body.requested_reviewer?.login ?? 'someone';
        await slack.sendDM(`:eyes: *Review requested* on PR #${num} in \`${repo}\`\n*${title}*\nReviewer: @${reviewer}\n${url}`, creds);
      }
    }

    if (event === 'push') {
      const ref    = body.ref ?? '';
      const branch = ref.replace('refs/heads/', '');
      const repo   = body.repository?.full_name ?? '';
      const def    = body.repository?.default_branch ?? 'main';
      if (branch === def) {
        const commits = (body.commits ?? []).slice(0, 3);
        const lines   = commits.map(c => `• ${c.message.split('\n')[0]} — @${c.author?.username ?? 'unknown'}`).join('\n');
        const more    = (body.commits?.length ?? 0) > 3 ? `\n+${body.commits.length - 3} more` : '';
        await slack.sendDM(`:git: *Push to \`${branch}\`* in \`${repo}\`\n${lines}${more}`, creds);
      }
    }

    if (event === 'issues') {
      const issue  = body.issue;
      const repo   = body.repository?.full_name ?? '';
      const author = issue.user?.login ?? 'unknown';
      const url    = issue.html_url ?? '';
      const title  = issue.title ?? 'Untitled issue';
      const num    = issue.number;
      if (body.action === 'opened') {
        await slack.sendDM(`:bug: *New issue #${num}* in \`${repo}\`\n*${title}*\nBy: @${author}\n${url}`, creds);
      } else if (body.action === 'closed') {
        await slack.sendDM(`:white_check_mark: *Issue #${num} closed* in \`${repo}\`\n*${title}*\n${url}`, creds);
      }
    }

    if (event === 'release' && body.action === 'published') {
      const rel  = body.release;
      const repo = body.repository?.full_name ?? '';
      await slack.sendDM(`:rocket: *Release published* in \`${repo}\`\n*${rel.name || rel.tag_name}*\n${rel.html_url}`, creds);
    }

  } catch (err) {
    console.error('[webhook/github]', err.message);
  }
});

export default router;
