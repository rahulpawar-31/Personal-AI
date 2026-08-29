// Single source of truth for how the flat nav array groups visually in
// Sidebar.jsx. App.jsx's digit-key shortcuts read the same grouping via
// flattenVisualOrder() so "press 2" always matches whatever's visually
// 2nd on screen, instead of the two drifting apart.
export const GROUP_ORDER = ['Overview', 'Inbox & calendar', 'Work', 'Social'];

export const GROUP_BY_ID = {
  digest: 'Overview', chat: 'Overview',
  comms: 'Inbox & calendar', calendar: 'Inbox & calendar',
  tasks: 'Work', github: 'Work',
  linkedin: 'Social', slack: 'Social',
};

// Buckets the groupable (non-settings/admin) items by GROUP_ORDER,
// preserving each item's relative order within its group.
export function groupMainNavItems(navItems) {
  const mainItems = navItems.filter(n => GROUP_BY_ID[n.id]);
  return GROUP_ORDER
    .map(group => ({ group, items: mainItems.filter(n => GROUP_BY_ID[n.id] === group) }))
    .filter(g => g.items.length > 0);
}

// Flattened visual order of the grouped main items — settings/admin are
// deliberately excluded (there's no room left in 1-9 once 8 panels are
// assigned, and they're always one click or a palette search away).
export function flattenVisualOrder(navItems) {
  return groupMainNavItems(navItems).flatMap(g => g.items);
}
