// The jobs a user can pick in onboarding or Settings. Ids must match
// server/lib/roles.js, which rejects anything else.
export const ROLES = [
  { id: 'developer',          label: 'Developer',          hint: 'PRs, issues, deploys' },
  { id: 'sales',              label: 'Sales',              hint: 'Deals, leads, follow-ups' },
  { id: 'freelancer-founder', label: 'Freelancer or founder', hint: 'Clients, invoices, decisions' },
  { id: 'custom',             label: 'Something else',     hint: 'Choose your own cards later' },
];

export function roleLabel(id) {
  return ROLES.find(r => r.id === id)?.label ?? null;
}
