/**
 * Canonical production URL for share intents / links. Hard-coded rather
 * than derived from `location.origin` so a share fired from a local dev
 * session still points at the live app — sharing
 * "http://localhost:5173/rhygym/" would be useless to whoever clicks it.
 */
export const SHARE_URL = 'https://tkg1683.github.io/rhygym/';
