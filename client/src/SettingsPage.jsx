import { useState, useEffect } from 'react';
import { apiFetch } from './api.js';
import { SectionLabel, IntegrationGroup, RowDivider } from './components/settings/primitives.jsx';
import SingleKeyRow from './components/settings/SingleKeyRow.jsx';
import MultiKeyRow from './components/settings/MultiKeyRow.jsx';
import GoogleRow from './components/settings/GoogleRow.jsx';
import AccountSection from './components/settings/AccountSection.jsx';
import { LoadingState } from './components/ui/States.jsx';

export default function SettingsPage({ user, onLogout, health = {} }) {
  const [saved,        setSaved]        = useState({});
  const [testing,      setTesting]      = useState(null);
  const [errors,       setErrors]       = useState({});
  const [warnings,     setWarnings]     = useState({});
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail,     setGoogleEmail]     = useState(null);
  const [googleError,  setGoogleError]  = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [webhookInfo,  setWebhookInfo]  = useState(null);
  const [webhookCopied, setWebhookCopied] = useState(false);

  useEffect(() => {
    loadSaved();
    loadGoogleStatus();
    loadWebhookInfo();
    if (window.location.search.includes('google_connected=true')) {
      window.history.replaceState({}, '', '/settings');
      loadGoogleStatus();
    }
  }, []);

  async function loadSaved() {
    try {
      const r = await apiFetch('/api/integrations');
      if (r.ok) setSaved(await r.json());
    } finally {
      setLoading(false);
    }
  }

  async function loadWebhookInfo() {
    try {
      const r = await apiFetch('/api/webhook/info');
      if (r.ok) setWebhookInfo(await r.json());
    } catch { /* ignore */ }
  }

  async function loadGoogleStatus() {
    const r = await apiFetch('/api/auth/google/email');
    if (!r.ok) return;
    const d = await r.json();
    setGoogleConnected(d.connected);
    setGoogleEmail(d.email);
  }

  async function handleGoogleConnect() {
    setGoogleError(null);
    try {
      const r = await apiFetch(`/api/auth/google/init?from=settings&origin=${encodeURIComponent(window.location.origin)}`);
      if (r.status === 401) {
        setGoogleError('Your session expired. Please sign out and sign back in, then try again.');
        return;
      }
      if (!r.ok) {
        setGoogleError('Could not start Google sign-in. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in your .env file.');
        return;
      }
      const data = await r.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setGoogleError('Network error — is the server running?');
    }
  }

  async function testAndSave(service, payload) {
    setTesting(service);
    setErrors(e => ({ ...e, [service]: null }));
    setWarnings(w => ({ ...w, [service]: null }));
    try {
      const r = await apiFetch(`/api/credentials/test/${service}`, { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) {
        await loadSaved();
        if (d.warning) setWarnings(w => ({ ...w, [service]: d.warning }));
        return true;
      }
      setErrors(e => ({ ...e, [service]: d.error || 'Test failed' }));
    } catch (err) {
      setErrors(e => ({ ...e, [service]: err.message }));
    } finally {
      setTesting(null);
    }
    return false;
  }

  async function forceSaveNotion(service, payload) {
    setTesting(service);
    setErrors(e => ({ ...e, [service]: null }));
    setWarnings(w => ({ ...w, [service]: null }));
    try {
      const r = await apiFetch('/api/credentials/save/notion', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) {
        await loadSaved();
        if (d.warning) setWarnings(w => ({ ...w, [service]: d.warning }));
        return true;
      }
      setErrors(e => ({ ...e, [service]: d.error || 'Save failed' }));
    } catch (err) {
      setErrors(e => ({ ...e, [service]: err.message }));
    } finally {
      setTesting(null);
    }
    return false;
  }

  async function disconnect(service) {
    await apiFetch(`/api/integrations/${service}`, { method: 'DELETE' });
    await loadSaved();
  }

  const hasOwnAiKey = !!(saved.gemini?.GEMINI_API_KEY || saved.groq?.GROQ_API_KEY);
  const hasSharedAiKey = !!(health.geminiShared || health.groqShared);
  const aiMissing = !hasOwnAiKey && !hasSharedAiKey;

  if (loading) {
    return <LoadingState label="Loading settings…" />;
  }

  return (
    <div style={{ maxWidth: 640, width: '100%', margin: '0 auto', paddingBottom: 60 }}>
      {/* Page header */}
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          API keys are encrypted at rest and never logged.
        </p>
      </div>

      {aiMissing && (
        <div style={{
          marginTop: 16, padding: '10px 14px',
          borderRadius: 8, background: '#FFF8E1',
          border: '1px solid #FFCA28',
          fontSize: 12, color: '#6D4C00', lineHeight: 1.6,
        }}>
          <strong>No AI engine configured.</strong> Add a Gemini or Groq API key to enable the agent.
        </div>
      )}

      {hasSharedAiKey && !hasOwnAiKey && (
        <div style={{
          marginTop: 16, padding: '10px 14px',
          borderRadius: 8, background: 'var(--tag-success-bg)',
          border: '1px solid var(--success)',
          fontSize: 12, color: 'var(--success)', lineHeight: 1.6,
        }}>
          <strong>AI is ready.</strong> Shared workspace keys are active — you don't need to add your own unless you want a separate quota.
        </div>
      )}

      {/* AI Engine */}
      <SectionLabel label="AI Engine" tag={hasSharedAiKey && !hasOwnAiKey ? 'optional' : 'required'} />
      <IntegrationGroup>
        <SingleKeyRow
          service="gemini"
          label="Gemini"
          description={health.geminiShared && !saved.gemini?.GEMINI_API_KEY ? "Shared workspace key active. Add your own to use a separate quota." : "Powers the agent, email triage, calendar summaries, and content generation."}
          linkHref="https://aistudio.google.com/apikey"
          keyName="GEMINI_API_KEY"
          fieldLabel="Gemini API key"
          fieldHint="Google AI Studio → Get API key → Create API key"
          saved={saved} testing={testing}
          onTest={(svc, key) => testAndSave(svc, { key })}
          onDisconnect={disconnect}
          error={errors.gemini}
          warning={warnings.gemini}
        />
        <RowDivider />
        <SingleKeyRow
          service="groq"
          label="Groq"
          description={health.groqShared && !saved.groq?.GROQ_API_KEY ? "Shared workspace key active. Add your own to use a separate quota." : "Fast inference fallback — used when Gemini is rate-limited."}
          linkHref="https://console.groq.com/keys"
          keyName="GROQ_API_KEY"
          fieldLabel="Groq API key"
          fieldHint="Groq Console → API Keys → Create API Key"
          saved={saved} testing={testing}
          onTest={(svc, key) => testAndSave(svc, { key })}
          onDisconnect={disconnect}
          error={errors.groq}
        />
      </IntegrationGroup>

      {/* Google */}
      <SectionLabel label="Google" tag={googleConnected ? 'optional' : 'required'} />
      <IntegrationGroup>
        <GoogleRow
          connected={googleConnected}
          email={googleEmail}
          onConnect={handleGoogleConnect}
          error={googleError}
        />
      </IntegrationGroup>

      {/* Productivity tools */}
      <SectionLabel label="Productivity tools" tag="recommended" />
      <IntegrationGroup>
        <MultiKeyRow
          service="notion" label="Notion"
          description="Task and notes database. Create, list, and update tasks and notes via the agent."
          primaryKey="NOTION_API_KEY"
          saved={saved} testing={testing}
          onTest={(svc, v) => testAndSave(svc, { apiKey: v.apiKey, taskDbId: v.taskDbId, notesDbId: v.notesDbId })}
          onForceSave={(svc, v) => forceSaveNotion(svc, { apiKey: v.apiKey, taskDbId: v.taskDbId, notesDbId: v.notesDbId })}
          onDisconnect={disconnect} error={errors.notion} warning={warnings.notion}
          fields={[
            { key: 'apiKey',    label: 'Notion Integration Secret', hint: 'app.notion.com/developers/connections → copy the Access token', linkText: 'Open', linkHref: 'https://www.notion.so/profile/integrations', placeholder: 'ntn_… or secret_ntn_…' },
            { key: 'taskDbId',  label: 'Tasks Database ID',  hint: 'Open the database in Notion — paste the full URL or just the 32-char ID from it', placeholder: 'URL or 32-char ID (optional)', type: 'text' },
            { key: 'notesDbId', label: 'Notes Database ID',  hint: 'Open the database in Notion — paste the full URL or just the 32-char ID from it', placeholder: 'URL or 32-char ID (optional)', type: 'text' },
          ]}
        />
        <RowDivider />
        <SingleKeyRow
          service="todoist"
          label="Todoist"
          description="Task management. Create, complete, and list your today's tasks via the agent."
          linkHref="https://app.todoist.com/app/settings/integrations/developer"
          keyName="TODOIST_API_KEY"
          fieldLabel="Todoist API token"
          fieldHint="Todoist → Settings → Integrations → Developer → API token"
          saved={saved} testing={testing}
          onTest={(svc, key) => testAndSave(svc, { key })}
          onDisconnect={disconnect}
          error={errors.todoist}
        />
        <RowDivider />
        <MultiKeyRow
          service="github" label="GitHub"
          description="PRs, issues, and code activity. Create issues, track stale PRs, and generate changelogs."
          primaryKey="GITHUB_TOKEN"
          saved={saved} testing={testing}
          onTest={(svc, v) => testAndSave(svc, { token: v.token, owner: v.owner, repo: v.repo })}
          onDisconnect={disconnect} error={errors.github}
          fields={[
            { key: 'token', label: 'Personal Access Token', hint: 'GitHub → Settings → Developer settings → Personal access tokens (classic) with repo scope', linkText: 'Generate', linkHref: 'https://github.com/settings/tokens', placeholder: 'ghp_…' },
            { key: 'owner', label: 'Username / org', hint: 'Your GitHub username or org name', placeholder: 'your-username', type: 'text' },
            { key: 'repo',  label: 'Default repository', hint: 'Just the repo name (not the full URL)', placeholder: 'my-repo', type: 'text' },
          ]}
        />
        {webhookInfo && !webhookInfo.url.includes('localhost') && (
          <div style={{
            margin: '0 0 0 0', padding: '12px 20px 14px',
            background: 'var(--surface)', borderTop: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              GitHub Webhook URL
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code style={{
                flex: 1, fontSize: 11, padding: '5px 10px', minWidth: 160,
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text)',
                overflowX: 'auto', whiteSpace: 'nowrap', display: 'block',
              }}>
                {webhookInfo.url}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(webhookInfo.url);
                  setWebhookCopied(true);
                  setTimeout(() => setWebhookCopied(false), 2000);
                }}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600,
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  background: webhookCopied ? '#22c55e22' : 'var(--bg)',
                  color: webhookCopied ? '#22c55e' : 'var(--text-muted)',
                  cursor: 'pointer', flexShrink: 0, transition: 'all .15s',
                }}
              >
                {webhookCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Paste this URL in your GitHub repo → Settings → Webhooks.
              {webhookInfo.secret ? ' Webhook secret is configured.' : ' Set GITHUB_WEBHOOK_SECRET in .env for HMAC verification.'}
            </div>
          </div>
        )}
        <RowDivider />
        <MultiKeyRow
          service="trello" label="Trello"
          description="Board cards and stale card scan. Track work in progress and surface blockers."
          primaryKey="TRELLO_API_KEY"
          saved={saved} testing={testing}
          onTest={(svc, v) => testAndSave(svc, { apiKey: v.apiKey, token: v.token, boardId: v.boardId })}
          onDisconnect={disconnect} error={errors.trello}
          fields={[
            { key: 'apiKey',  label: 'Trello API Key',   hint: 'trello.com/app-key — key shown at the top', linkText: 'Get key', linkHref: 'https://trello.com/app-key', placeholder: 'API key…' },
            { key: 'token',   label: 'Trello Token',     hint: 'Same page → click "generate a token"', placeholder: 'Token…' },
            { key: 'boardId', label: 'Board ID',         hint: 'Open your board → copy short ID from URL', placeholder: 'Short board ID (optional)', type: 'text' },
          ]}
        />
      </IntegrationGroup>

      {/* Delivery channels */}
      <SectionLabel label="Delivery channels" tag="optional" />
      <IntegrationGroup>
        <MultiKeyRow
          service="slack" label="Slack"
          description="Team alerts and daily digests. The agent sends summaries and stale PR alerts to your Slack."
          primaryKey="SLACK_BOT_TOKEN"
          saved={saved} testing={testing}
          onTest={(svc, v) => testAndSave(svc, { botToken: v.botToken, userId: v.userId })}
          onDisconnect={disconnect} error={errors.slack}
          fields={[
            { key: 'botToken', label: 'Bot Token',       hint: 'api.slack.com/apps → OAuth & Permissions → install → copy Bot User OAuth Token', linkText: 'Slack API', linkHref: 'https://api.slack.com/apps', placeholder: 'xoxb-…' },
            { key: 'userId',   label: 'Your User ID',    hint: 'Slack → your name → View full profile → Copy member ID', placeholder: 'U…', type: 'text' },
          ]}
        />
        <RowDivider />
        <MultiKeyRow
          service="linkedin" label="LinkedIn"
          description="Post content via a Make.com webhook. The agent drafts posts from your recent activity."
          primaryKey="LINKEDIN_WEBHOOK_URL"
          saved={saved} testing={testing}
          onTest={(svc, v) => testAndSave(svc, { webhookUrl: v.webhookUrl })}
          onDisconnect={disconnect} error={errors.linkedin}
          fields={[
            { key: 'webhookUrl', label: 'Make.com Webhook URL', hint: 'Create a webhook scenario in Make.com that posts to LinkedIn, paste the URL here', linkText: 'Make.com', linkHref: 'https://www.make.com', placeholder: 'https://hook.make.com/…', type: 'text' },
          ]}
        />
      </IntegrationGroup>

      {/* Account */}
      <SectionLabel label="Account" tag="optional" />
      <AccountSection user={user} onLogout={onLogout} />

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button
          onClick={onLogout}
          style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 16px', background: 'transparent' }}
        >
          Sign out of @{user.username}
        </button>
      </div>
    </div>
  );
}
