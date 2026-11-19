// client/src/dashboardState.js
// What the Today dashboard may say about the user's queue, given what it actually knows.
//
// "Nothing needs you" is only true once something has been checked. Before that, the
// honest messages are: connect a tool, run your first scan, still loading, or the scan
// failed (#426). Kept as a pure function so each state can be tested without a browser.
//
// workConnected: how many work services are connected (Google, GitHub, Slack, Notion,
//                Todoist, Trello). The AI provider is deliberately not counted: it
//                gives the app nothing to scan.
// digestStatus:  'loading' (first load not back yet) | 'none' (loaded, no digest has
//                ever been run) | 'ready' (a digest exists) | 'error' (it could not be loaded)
// running:       a digest run is in progress
// runFailed:     the last digest run failed
// queueLength:   items in the Needs-you queue after snoozes
//
// Returns { kind, summary, detail, action }:
//   kind    'scanning' | 'items' | 'loading' | 'error' | 'clear' | 'setup' | 'noScan'
//   summary the greeting line under the heading (without the next-meeting sentence)
//   detail  the sentence shown in the Needs-you list when it has no items ('' if it has some)
//   action  null, or { id, label } for the button that fits the state:
//           'settings' (Open Settings), 'run' (Run digest), 'retry' (Retry)
export function needsYouState({ workConnected = 0, digestStatus = 'loading', running = false, runFailed = false, queueLength = 0 } = {}) {
  if (running) {
    return { kind: 'scanning', summary: 'Scanning your mail and tasks…', detail: '', action: null };
  }
  if (queueLength > 0) {
    const noun = queueLength === 1 ? 'thing needs' : 'things need';
    return { kind: 'items', summary: `${queueLength} ${noun} you today.`, detail: '', action: null };
  }
  if (digestStatus === 'loading') {
    return { kind: 'loading', summary: 'Checking your day…', detail: 'Checking your day…', action: null };
  }
  if (digestStatus === 'error' || runFailed) {
    return {
      kind: 'error',
      summary: "We couldn't check your day.",
      detail: runFailed ? "The last scan didn't finish, so we can't say what needs you." : "We couldn't load your latest digest, so we can't say what needs you.",
      action: { id: 'retry', label: 'Retry' },
    };
  }
  if (digestStatus === 'ready') {
    return { kind: 'clear', summary: 'Nothing needs you right now.', detail: 'Nothing here. A clear day.', action: null };
  }
  // No digest has ever been run.
  if (workConnected === 0) {
    return {
      kind: 'setup',
      summary: 'Connect a tool to get started.',
      detail: 'There is nothing to scan yet. Connect Google, GitHub or another tool first.',
      action: { id: 'settings', label: 'Open Settings' },
    };
  }
  return {
    kind: 'noScan',
    summary: 'Run your digest to see what needs you.',
    detail: "Your tools are connected but haven't been scanned yet. Run your first digest.",
    action: { id: 'run', label: 'Run digest' },
  };
}
