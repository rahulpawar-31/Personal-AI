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
