// server/lib/roles.js
// The jobs a user can pick during onboarding. The role will decide which Today
// cards, integrations and AI actions a user sees; for now it is only stored.
// The client keeps its own copy of the labels in client/src/roles.js.
export const ROLES = ['developer', 'sales', 'freelancer-founder', 'custom'];

export function isValidRole(role) {
  return typeof role === 'string' && ROLES.includes(role);
}
