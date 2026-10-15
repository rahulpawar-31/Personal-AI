// Friendly names for the service ids the server stores keys under. An id this
// list does not know is shown as stored, so a new service never disappears
// from the admin page.
const LABELS = {
  gemini: 'Gemini', groq: 'Groq', notion: 'Notion', github: 'GitHub', trello: 'Trello',
  slack: 'Slack', linkedin: 'LinkedIn', todoist: 'Todoist', google: 'Google',
};

export function serviceLabel(id) {
  return LABELS[id] ?? String(id);
}

export function serviceLabels(ids) {
  return Array.isArray(ids) ? ids.map(serviceLabel) : [];
}

// Groups the admin key list ({ service, keyName, ... } rows) by service, in
// the order the rows arrive, for the user-keys modal.
export function groupKeysByService(rows) {
  const groups = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let g = groups.find(x => x.service === row.service);
    if (!g) { g = { service: row.service, label: serviceLabel(row.service), keys: [] }; groups.push(g); }
    g.keys.push(row);
  }
  return groups;
}
