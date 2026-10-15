// server/lib/sourceErrors.js
// One plain sentence for why a task source (Notion, Todoist) failed to load, so
// the Tasks board can say so instead of showing an empty column that looks like
// "no tasks". Never includes keys; provider messages are shortened.

function oneLine(text, max = 140) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function describeSourceError(source, err) {
  const message = String(err?.message ?? err ?? '');
  if (source === 'notion') {
    if (err?.code === 'object_not_found' || /could not find (database|page)/i.test(message)) {
      return "Notion can't find your Tasks database. Open it in Notion and share it with the DevOS integration.";
    }
    if (err?.code === 'unauthorized' || /\b401\b|api token is invalid/i.test(message)) {
      return 'Notion rejected the API key. Enter it again in Settings.';
    }
    return `Notion tasks failed to load: ${oneLine(message)}`;
  }
  if (source === 'todoist') {
    if (/\b(401|403)\b/.test(message)) return 'Todoist rejected the API key. Enter it again in Settings.';
    return `Todoist tasks failed to load: ${oneLine(message)}`;
  }
  return `${source} failed to load: ${oneLine(message)}`;
}
