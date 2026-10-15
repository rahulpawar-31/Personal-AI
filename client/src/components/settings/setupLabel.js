// client/src/components/settings/setupLabel.js
// The text of the "get your key" link in an integration's setup panel:
// "<service> <first field> Setup". When the field's name already starts with the
// service name ("Trello" + "Trello API Key"), the service is not repeated.

export function setupLinkLabel(serviceLabel, fieldLabel) {
  const field = fieldLabel || 'Credentials';
  const repeats = field.toLowerCase().startsWith(String(serviceLabel).toLowerCase());
  return repeats ? `${field} Setup` : `${serviceLabel} ${field} Setup`;
}
