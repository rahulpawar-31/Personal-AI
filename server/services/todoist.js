// server/services/todoist.js
// Todoist API v1

const BASE = 'https://api.todoist.com/api/v1';

function headers(creds = {}) {
  return {
    Authorization: `Bearer ${creds.TODOIST_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export function isConfigured(creds = {}) {
  return Boolean(creds.TODOIST_API_KEY);
}

function formatTask(t) {
  const done = t.is_completed ?? t.checked ?? false;
  return {
    id:         t.id,
    title:      t.content,
    status:     done ? 'Done' : 'Not started',
    source:     'todoist',
    due:        t.due?.date ?? null,           // 'YYYY-MM-DD' or null
    priority:   t.priority ?? 1,              // 1=normal 2=medium 3=high 4=urgent
    project_id: t.project_id ?? null,
    labels:     t.labels ?? [],
  };
}

export async function createTask(title, dueDateString = 'today', creds = {}) {
  if (!isConfigured(creds)) throw new Error('Todoist API key not configured');
  const body = { content: title };
  if (dueDateString) body.due_string = dueDateString;
  const res = await fetch(`${BASE}/tasks`, {
    method:  'POST',
    headers: headers(creds),
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Todoist error ${res.status}: ${text || 'unknown error'}`);
  }
  return formatTask(await res.json());
}

// `throwOnError` is for callers that want to show the failure (the Tasks board);
// the others (digest, chat) keep the old behaviour of an empty list.
export async function getTasks(filter = 'today | overdue', creds = {}, { throwOnError = false } = {}) {
  if (!isConfigured(creds)) return [];
  try {
    // API v1 has a dedicated filter endpoint. If it is not available, fall back to
    // the older ?filter= form so this can never do worse than it did before.
    let res = await fetch(`${BASE}/tasks/filter?query=${encodeURIComponent(filter)}`, { headers: headers(creds) });
    if (!res.ok) res = await fetch(`${BASE}/tasks?filter=${encodeURIComponent(filter)}`, { headers: headers(creds) });
    if (!res.ok) throw new Error(`Todoist ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    const tasks = Array.isArray(data) ? data : (data.results ?? []);
    return tasks.map(formatTask);
  } catch (err) {
    console.error('[todoist] getTasks:', err.message);
    if (throwOnError) throw err;
    return [];
  }
}

// The active-tasks endpoint above structurally never returns completed tasks —
// Todoist excludes them regardless of filter. Without this, a task closed via
// updateTaskStatus() would vanish from every column (not just move to Done) as
// soon as the board refetches, since it's gone from the active list. Bounded to
// the last `days` so the Done column doesn't accumulate someone's entire
// multi-year completion history.
//
// The path is /tasks/completed/by_completion_date — with a slash. The earlier
// "completed_by_completion_date" was read by Todoist as a task id, which is the
// "task_id ... Non-base32 digit found" 400 seen in the production log. Both
// `since` and `until` are required, and the window is limited to about three
// months, so `days` is capped. Results are paged with a cursor.
const MAX_COMPLETED_DAYS = 85;
const MAX_COMPLETED_PAGES = 3;

export async function getRecentlyCompleted(creds = {}, days = 30, { throwOnError = false } = {}) {
  if (!isConfigured(creds)) return [];
  try {
    const now   = Date.now();
    const since = new Date(now - Math.min(days, MAX_COMPLETED_DAYS) * 86400000).toISOString();
    const until = new Date(now).toISOString();
    const tasks = [];
    let cursor = null;
    for (let page = 0; page < MAX_COMPLETED_PAGES; page += 1) {
      // Each page needs the previous page's cursor, so this is sequential.
      const url = `${BASE}/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`
        + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await fetch(url, { headers: headers(creds) });
      if (!res.ok) throw new Error(`Todoist ${res.status}: ${await res.text().catch(() => '')}`);
      const data = await res.json();
      tasks.push(...(Array.isArray(data) ? data : (data.items ?? data.results ?? [])));
      cursor = Array.isArray(data) ? null : (data.next_cursor ?? null);
      if (!cursor) break;
    }
    // Completed-task items carry `content`/`completed_at` but not `is_completed` —
    // formatTask() only checks is_completed/checked, so mark it explicit here.
    return tasks.map(t => formatTask({ ...t, is_completed: true }));
  } catch (err) {
    console.error('[todoist] getRecentlyCompleted:', err.message);
    if (throwOnError) throw err;
    return [];
  }
}

export async function updateTaskStatus(taskId, status, creds = {}) {
  if (!isConfigured(creds)) return null;
  try {
    const endpoint = status === 'Done'
      ? `${BASE}/tasks/${taskId}/close`
      : `${BASE}/tasks/${taskId}/reopen`;
    const res = await fetch(endpoint, { method: 'POST', headers: headers(creds) });
    if (!res.ok) throw new Error(`Todoist ${res.status}`);
    return { id: taskId, status };
  } catch (err) {
    console.error('[todoist] updateTaskStatus:', err.message);
    throw err;
  }
}

export async function updateTask(taskId, patches = {}, creds = {}) {
  if (!isConfigured(creds)) return null;
  try {
    const body = {};
    if (patches.title)   body.content    = patches.title;
    if (patches.dueDate) body.due_string = patches.dueDate;

    let result = null;
    if (Object.keys(body).length) {
      const res = await fetch(`${BASE}/tasks/${taskId}`, {
        method: 'POST', headers: headers(creds), body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Todoist ${res.status}: ${await res.text()}`);
      result = formatTask(await res.json());
    }

    // Todoist's task-update endpoint doesn't accept completion status —
    // it must go through the separate close/reopen endpoints.
    if (patches.status) {
      await updateTaskStatus(taskId, patches.status, creds);
      result = { ...(result ?? { id: taskId }), status: patches.status };
    }

    return result ?? { id: taskId };
  } catch (err) {
    console.error('[todoist] updateTask:', err.message);
    throw err;
  }
}

export async function deleteTask(taskId, creds = {}) {
  if (!isConfigured(creds)) return null;
  try {
    const res = await fetch(`${BASE}/tasks/${taskId}`, { method: 'DELETE', headers: headers(creds) });
    if (!res.ok) throw new Error(`Todoist ${res.status}: ${await res.text()}`);
    return { deleted: true, id: taskId };
  } catch (err) {
    console.error('[todoist] deleteTask:', err.message);
    throw err;
  }
}

export default { createTask, getTasks, getRecentlyCompleted, updateTaskStatus, updateTask, deleteTask, isConfigured };
