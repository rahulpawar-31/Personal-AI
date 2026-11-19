// server/lib/googleReturn.js
// Where the browser lands after Google's consent screen when a user connects Google.
//
// Always a path the deployed site serves. The frontend is a single page with no
// router, so Vercel only has a page at "/"; sending people to "/settings?..." gave a
// 404 on the live site (#421). A connection started from Settings is marked with
// google_connected=true, so the app can open Settings itself once it has loaded.
export function googleReturnPath({ fromSettings } = {}) {
  return fromSettings ? '/?google_connected=true' : '/?connected=true';
}

// Called only after verifying the signed state and both trusted origins. Google
// can keep its registered API callback while the browser completes the exchange
// through the frontend's /api proxy, where the refresh cookie belongs. `state`
// is a newly signed state with forwarded:true, so the second hop cannot loop.
export function googleCallbackForward({ origin, callbackOrigin, forwarded, code, state }) {
  if (origin === callbackOrigin || forwarded === true) return null;
  const url = new URL('/api/auth/google/callback', origin);
  url.searchParams.set('state', state);
  if (typeof code === 'string') url.searchParams.set('code', code);
  return url.href;
}
