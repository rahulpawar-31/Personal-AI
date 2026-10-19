import { useState, useEffect, useRef } from 'react';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import { toast } from '../toast.jsx';
import { LoadingState, EmptyState } from './ui/States.jsx';
import { newTaskErrors } from '../taskErrors.js';

// Task-source failures already toasted since the page loaded, so a board that reloads
// often does not repeat the same message.
const shownTaskErrors = new Set();

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLOR = { 4: 'var(--danger)', 3: 'var(--warning)', 2: 'var(--info)' };

// A decorative palette for arbitrary user-created columns — beyond the 3
// built-in statuses, there's no semantic token for "the 7th distinct hue",
// so most of these stay literal. The 4 that do match an existing token
// (warning/accent/danger/info) reference it instead of duplicating the hex.
const COL_ACCENTS = [
  '#2F6FDB','var(--warning)','var(--accent)','var(--danger)',
  '#6B4FD3','var(--info)','#ec4899','#14b8a6','#f97316','#64748b',
];

const STATUS_COL = {
  'Todo': 'todo', 'Not started': 'todo',
  'In progress': 'inprogress', 'In Progress': 'inprogress',
  'Done': 'done',
  'On Hold': 'onhold',
};

const COL_STATUS = {
  todo: 'Not started', inprogress: 'In progress',
  done: 'Done', onhold: 'On Hold',
};

const BUILT_IN = [
  { id: 'todo',       name: 'To Do',       accent: '#2F6FDB' },
  { id: 'inprogress', name: 'In Progress', accent: 'var(--warning)' },
  { id: 'done',       name: 'Done',        accent: 'var(--accent)' },
];

function dueFmt(iso) {
  if (!iso) return null;
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff  = Math.round((d - today) / 86400000);
  if (diff === 0)  return { text: 'Today',    color: 'var(--warning)' };
  if (diff === 1)  return { text: 'Tomorrow', color: 'var(--accent)' };
  if (diff < 0)    return { text: d.toLocaleDateString('en-US',{ month:'short', day:'numeric' }), color: 'var(--danger)' };
  return { text: d.toLocaleDateString('en-US',{ month:'short', day:'numeric' }), color: 'var(--muted)' };
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }) {
  const map = {
    todoist: { label: 'Todoist', bg: 'var(--tag-danger-bg)',  color: 'var(--tag-danger-fg)' },
    trello:  { label: 'Trello',  bg: 'var(--tag-info-bg)',    color: 'var(--tag-info-fg)'   },
    notion:  { label: 'Notion',  bg: 'var(--tag-gray-bg)',    color: 'var(--tag-gray-fg)'   },
  };
  const s = map[source] ?? map.notion;
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 'var(--radius-sm)',
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ─── Kanban card ──────────────────────────────────────────────────────────────

function Card({ task, onDragStart, onToggle }) {
  const due    = dueFmt(task.due);
  const done   = task.status === 'Done';
  const pColor = PRIORITY_COLOR[task.priority];

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('id', task.id); onDragStart(task); }}
      style={{
        background: 'var(--bg)',
        borderLeft: pColor ? `3px solid ${pColor}` : '3px solid transparent',
        borderRadius: 12,
        marginBottom: 8,
        cursor: 'grab',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px 11px' }}>
        {/* Title */}
        <p style={{
          margin: '0 0 10px', fontSize: 15, fontWeight: 500,
          lineHeight: 'var(--lh-normal)', color: done ? 'var(--muted)' : 'var(--text)',
          textDecoration: done ? 'line-through' : 'none',
        }}>
          {task.title}
        </p>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <SourceBadge source={task.source} />

          {due && (
            <span style={{
              fontSize: 'var(--fs-sm)', fontWeight: 500, color: due.color,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              {due.text}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {task.source !== 'trello' && onToggle && (
            <button
              onClick={e => { e.stopPropagation(); onToggle(task.id, task.status, task.source); }}
              title={done ? 'Reopen' : 'Mark done'}
              aria-label={done ? 'Reopen task' : 'Mark task done'}
              style={{
                width: 26, height: 26, borderRadius: 8, padding: 0, minHeight: 0,
                border: `1.5px solid ${done ? 'var(--success)' : 'var(--hint)'}`,
                background: done ? 'var(--success)' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all var(--t-fast)',
              }}
            >
              {done && (
                <span style={{ color: '#fff', fontSize: 11.5, fontWeight: 500, lineHeight: 1 }}>✓</span>
              )}
            </button>
          )}

          {task.url && (
            <a href={task.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{
                width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--muted)', textDecoration: 'none', flexShrink: 0,
                borderRadius: 'var(--radius-sm)',
              }}
              title="Open"
              aria-label="Open in source"
            >
              <span style={{ fontSize: 13 }}>↗</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function Column({ col, cards, isDragOver, onDragOver, onDragLeave, onDrop, onToggle, onAddTask, onCardDragStart }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle]   = useState('');
  const taRef = useRef(null);

  useEffect(() => { if (adding) taRef.current?.focus(); }, [adding]);

  async function submit() {
    const t = title.trim();
    if (!t) return;
    await onAddTask(t);
    setTitle(''); setAdding(false);
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop(); }}
      style={{
        minWidth: 300, maxWidth: 300,
        display: 'flex', flexDirection: 'column',
        // Column background — distinct from page bg
        background: isDragOver ? `color-mix(in srgb, ${col.accent} 3%, transparent)` : 'var(--surface)',
        border: `1px solid ${isDragOver ? col.accent : 'var(--border)'}`,
        borderRadius: 16,
        transition: 'border-color var(--t-fast), background var(--t-fast)',
        // Height management
        maxHeight: 'calc(100vh - 260px)',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{
        padding: '18px 18px 12px',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: col.accent, flexShrink: 0 }} />
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
          {col.name}
        </h2>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)',
        }}>
          {cards.length}
        </span>
      </div>

      {/* Scrollable card list */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '2px 12px 2px',
        // Custom scrollbar
        scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent',
      }}>
        {cards.length === 0 && !adding && (
          <div style={{
            margin: '4px 0 8px', padding: '18px 12px',
            border: '1.5px dashed var(--border-strong)', borderRadius: 12,
            textAlign: 'center', fontSize: 14, color: 'var(--muted)',
            transition: 'border-color var(--t-fast)',
          }}>
            {isDragOver ? 'Drop here' : 'No cards'}
          </div>
        )}
        {cards.map(c => (
          <Card key={c.id} task={c} onDragStart={onCardDragStart} onToggle={onToggle} />
        ))}
      </div>

      {/* Add card */}
      <div style={{ padding: '4px 12px 14px', flexShrink: 0 }}>
        {adding ? (
          <div>
            <textarea
              ref={taRef}
              rows={2}
              placeholder="Card title…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                if (e.key === 'Escape') { setAdding(false); setTitle(''); }
              }}
              style={{
                width: '100%', fontSize: 'var(--fs-base)', resize: 'none',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
                padding: '6px 8px', marginBottom: 6, fontFamily: 'inherit',
                lineHeight: 'var(--lh-normal)',
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="primary" onClick={submit}
                style={{ fontSize: 'var(--fs-md)', padding: '5px 12px' }}>
                Add
              </button>
              <button onClick={() => { setAdding(false); setTitle(''); }}
                style={{ fontSize: 'var(--fs-md)', padding: '5px 10px' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              width: '100%', textAlign: 'left', padding: '0 10px', minHeight: 44,
              fontSize: 14, fontWeight: 500, color: 'var(--text-2)',
              background: 'transparent', borderRadius: 'var(--radius)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            +
            Add a card
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Notion Notes column ──────────────────────────────────────────────────────

function NoteCard({ note }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: 'var(--border-hairline)',
        borderRadius: 'var(--radius)',
        marginBottom: 6,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px 9px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          flex: 1, fontSize: 'var(--fs-base)', fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {note.title || 'Untitled'}
        </span>
        {note.url && (
          <a href={note.url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: 'var(--hint)', textDecoration: 'none', flexShrink: 0 }}
            title="Open in Notion"
            aria-label="Open in Notion"
          >
            <span style={{ fontSize: 13 }}>↗</span>
          </a>
        )}
      </div>
    </div>
  );
}

function NotionNotesColumn({ notes, onAdd }) {
  const [adding,    setAdding]    = useState(false);
  const [title,     setTitle]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [exporting, setExporting] = useState(false);
  const taRef = useRef(null);
  const ACCENT = '#6B4FD3';

  useEffect(() => { if (adding) taRef.current?.focus(); }, [adding]);

  async function exportMd() {
    setExporting(true);
    try {
      const r = await apiFetch('/api/notes/export');
      if (!r.ok) throw new Error((await r.json()).error || 'Export failed');
      const { files } = await r.json();
      if (!files?.length) { toast('No notes to export'); return; }

      // Download each file individually as .md
      for (const f of files) {
        const blob = new Blob([f.content], { type: 'text/markdown' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        // small delay between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      await onAdd(t);
      setTitle(''); setAdding(false);
    } finally { setSaving(false); }
  }

  return (
    <div style={{
      minWidth: 300, maxWidth: 300, flexShrink: 0,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16,
      maxHeight: 'calc(100vh - 260px)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '18px 18px 12px',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: ACCENT, flexShrink: 0 }} />
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
          Notion Notes
        </h2>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)',
        }}>
          {notes.length}
        </span>
        <button
          onClick={exportMd}
          disabled={exporting || notes.length === 0}
          title="Export all notes as Markdown files"
          aria-label="Export all notes as Markdown files"
          style={{
            padding: '2px 7px', fontSize: 11.5, fontWeight: 500,
            border: `1px solid ${ACCENT}30`, borderRadius: 'var(--radius-sm)',
            background: 'transparent', color: ACCENT, cursor: notes.length ? 'pointer' : 'default',
            opacity: notes.length ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 3,
          }}
        >
          {exporting ? '…' : 'MD'}
        </button>
      </div>

      {/* Note cards */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '2px 12px 2px',
        scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent',
      }}>
        {notes.length === 0 && !adding && (
          <div style={{
            margin: '4px 0 8px', padding: '18px 12px',
            border: '1.5px dashed var(--border-strong)', borderRadius: 12,
            textAlign: 'center', fontSize: 14, color: 'var(--muted)',
          }}>
            No pages yet
          </div>
        )}
        {notes.map((n, i) => <NoteCard key={n.id ?? i} note={n} />)}
      </div>

      {/* Add page */}
      <div style={{ padding: '4px 12px 14px', flexShrink: 0 }}>
        {adding ? (
          <div>
            <textarea
              ref={taRef}
              rows={2}
              placeholder="Page title…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                if (e.key === 'Escape') { setAdding(false); setTitle(''); }
              }}
              style={{
                width: '100%', fontSize: 'var(--fs-base)', resize: 'none',
                border: `1px solid ${ACCENT}`, borderRadius: 'var(--radius)',
                padding: '6px 8px', marginBottom: 6, fontFamily: 'inherit',
                lineHeight: 'var(--lh-normal)',
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="primary" onClick={submit} disabled={saving}
                style={{ fontSize: 'var(--fs-md)', padding: '5px 12px' }}>
                {saving ? 'Creating…' : 'Add'}
              </button>
              <button onClick={() => { setAdding(false); setTitle(''); }}
                style={{ fontSize: 'var(--fs-md)', padding: '5px 10px' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              width: '100%', textAlign: 'left', padding: '0 10px', minHeight: 44,
              fontSize: 14, fontWeight: 500, color: 'var(--text-2)',
              background: 'transparent', borderRadius: 'var(--radius)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            +
            New page
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TaskPanel({ refreshKey, onGoToSettings }) {
  const [notionTasks,  setNotionTasks]  = useState([]);
  const [todoistTasks, setTodoistTasks] = useState([]);
  const [trelloLists,  setTrelloLists]  = useState([]);
  const [trelloCards,  setTrelloCards]  = useState([]);
  const [notionNotes,    setNotionNotes]    = useState([]);
  const [notionEnabled,  setNotionEnabled]  = useState(false);
  const [loading,        setLoading]        = useState(true);
  const [newTask,      setNewTask]      = useState('');
  const [dragOver,     setDragOver]     = useState(null);
  const dragging = useRef(null);

  useEffect(() => { load(); }, [refreshKey]);

  async function load() {
    setLoading(true);
    try {
      const [tr, tsk, nt] = await Promise.all([
        apiFetch('/api/trello/board'),
        apiFetch('/api/tasks'),
        apiFetch('/api/notes'),
      ]);
      if (tr.ok)  { const d = await tr.json();  setTrelloLists(d.lists ?? []); setTrelloCards(d.cards ?? []); }
      if (tsk.ok) {
        const d = await tsk.json();
        // A source that failed keeps what it showed before: the API sends an empty list for it,
        // and replacing the column with that would wipe real tasks during a brief outage.
        if (!d.errors?.notion)  setNotionTasks(d.notion ?? []);
        if (!d.errors?.todoist) setTodoistTasks(d.todoist ?? []);
        // A source that failed says so (once), instead of an empty column that looks like "no tasks".
        newTaskErrors(d.errors, shownTaskErrors).forEach(msg => toast(msg, 'error'));
      }
      if (nt.ok)  { const d = await nt.json();  setNotionEnabled(true); setNotionNotes(Array.isArray(d) ? d.slice(0, 10) : []); }
    } finally { setLoading(false); }
  }

  async function addTask(title) {
    const r = await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
    if (r.ok) load();
    else toast('Could not add task', 'error');
  }

  async function addNote(title) {
    const r = await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify({ title }) });
    if (r.ok) {
      const note = await r.json();
      setNotionNotes(prev => [note, ...prev]);
    } else {
      toast('Could not add note', 'error');
    }
  }

  async function toggleDone(id, status, source) {
    const next = status === 'Done' ? 'Not started' : 'Done';
    const r = await apiFetch('/api/task/update', { method: 'POST', body: JSON.stringify({ id, status: next, source }) });
    if (!r.ok) { toast('Could not update task', 'error'); return; }
    const up = ts => ts.map(x => (x.id === id ? { ...x, status: next } : x));
    if (source === 'todoist') setTodoistTasks(up); else setNotionTasks(up);
  }

  function handleDragStart(card) { dragging.current = card; }

  async function handleDrop(targetColId) {
    const card = dragging.current;
    setDragOver(null);
    if (!card || card._colId === targetColId) { dragging.current = null; return; }

    if (card.source === 'trello') {
      setTrelloCards(prev => prev.map(c => (c.id === card.id ? { ...c, listId: targetColId } : c)));
      const r = await apiFetch('/api/trello/move', { method: 'POST', body: JSON.stringify({ cardId: card.id, listId: targetColId }) });
      if (!r.ok) toast('Could not move card — refresh to see the current state', 'error');
    } else {
      const newStatus = COL_STATUS[targetColId] ?? 'Not started';
      const up = ts => ts.map(c => (c.id === card.id ? { ...c, status: newStatus } : c));
      if (card.source === 'todoist') setTodoistTasks(up); else setNotionTasks(up);
      const r = await apiFetch('/api/task/update', { method: 'POST', body: JSON.stringify({ id: card.id, status: newStatus, source: card.source }) });
      if (!r.ok) toast('Could not update task — refresh to see the current state', 'error');
    }
    dragging.current = null;
  }

  const hasTrello = trelloLists.length > 0;

  const columns = hasTrello
    ? trelloLists.map((l, i) => ({
        id: l.id, name: l.name, accent: COL_ACCENTS[i % COL_ACCENTS.length],
        cards: trelloCards.filter(c => c.listId === l.id).map(c => ({ ...c, source: 'trello', _colId: l.id })),
      }))
    : BUILT_IN.map(col => ({
        ...col,
        cards: [
          ...todoistTasks.map(t => ({ ...t, source: 'todoist', _colId: col.id })),
          ...notionTasks.map(t  => ({ ...t, source: 'notion',  _colId: col.id })),
        ].filter(t => (STATUS_COL[t.status] ?? 'todo') === col.id),
      }));

  const hasAny = columns.some(c => c.cards.length > 0) || notionEnabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>

      <PageHeader
        eyebrow="Work"
        title="Tasks"
        subtitle={loading ? 'Loading your tasks…' : `${columns.reduce((n, c) => n + c.cards.length, 0)} cards across ${columns.length} lists.`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 5px 5px 14px', border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--surface)', minWidth: 'min(320px, 100%)' }}>
          <input
            aria-label="Add a task"
            placeholder="Add a task"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newTask.trim()) { addTask(newTask.trim()); setNewTask(''); } }}
            style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', minHeight: 40, padding: 0, boxShadow: 'none' }}
          />
          <button className="primary"
            onClick={() => { if (newTask.trim()) { addTask(newTask.trim()); setNewTask(''); } }}
            style={{ minHeight: 44, padding: '0 18px', whiteSpace: 'nowrap', fontSize: 14 }}
          >
            Add
          </button>
        </div>
      </PageHeader>

      {/* First load — nothing to show yet */}
      {loading && !hasAny && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingState label="Loading tasks…" />
        </div>
      )}

      {/* Empty */}
      {!loading && !hasAny && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState
            title="No tasks yet"
            description="Connect Todoist, Notion, or Trello in Settings"
            actionLabel="Open Settings"
            onAction={onGoToSettings}
          />
        </div>
      )}

      {/* Board */}
      {hasAny && (
        <div
          onDragEnd={() => { dragging.current = null; setDragOver(null); }}
          style={{
            display: 'flex', gap: 12, overflowX: 'auto', flex: 1,
            alignItems: 'flex-start', paddingBottom: 16,
            // Subtle scrollbar
            scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent',
          }}
        >
          {columns.map(col => (
            <Column
              key={col.id}
              col={col}
              cards={col.cards.map(c => ({ ...c, _colId: col.id }))}
              isDragOver={dragOver === col.id}
              onDragOver={() => setDragOver(col.id)}
              onDragLeave={() => setDragOver(d => (d === col.id ? null : d))}
              onDrop={() => handleDrop(col.id)}
              onToggle={hasTrello ? null : toggleDone}
              onAddTask={addTask}
              onCardDragStart={handleDragStart}
            />
          ))}

          {/* Notion Notes column */}
          {notionEnabled && <NotionNotesColumn notes={notionNotes} onAdd={addNote} />}
        </div>
      )}
    </div>
  );
}
