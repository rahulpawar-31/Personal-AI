// Split a "Name <email>" header into its two parts. The From header is set by
// whoever sent the message, so this must stay linear: a regex with nested
// `\s*` / `.*?` around the quotes took over a minute on 5,000 spaces.
export function parseFrom(from = '') {
  const trimmed = from.trimEnd();
  const lt = trimmed.indexOf('<');
  const gt = trimmed.length - 1;
  // The header has to end with the closing bracket, with at least one
  // character between the brackets.
  if (lt === -1 || !trimmed.endsWith('>') || gt - lt < 2) return { name: from.trim(), email: '' };

  let name = trimmed.slice(0, lt).trimStart();
  if (name.startsWith('"')) name = name.slice(1);
  name = name.trimEnd();
  if (name.endsWith('"')) name = name.slice(0, -1);

  const email = trimmed.slice(lt + 1, gt).trim();
  return { name: name.trim() || email, email };
}
