# The `/api/*` rewrite

`vercel.json` sends `/api/*` to the API host. Two things about it are worth
knowing before editing either side.

## It is what makes the session cookie work

The browser talks to `ayeandnay.com/api/...`, same origin as the page, so the
Better Auth cookie is first-party. Pointing the web app straight at the API
hostname instead would make every authenticated request cross-site, and the
cookie rules that follow from that are the reason logins broke on this project
before. Keep the rewrite.

## Its destination is currently tied to the Railway service name

It targets the generated `<service>.up.railway.app` address. That hostname is
derived from the **service name**, so renaming the Railway service — an obvious
thing to do during a rebrand — silently breaks this rewrite and takes the whole
API down with it.

`api.ayeandnay.com` is already a verified Railway custom domain and serving.
Moving the destination to it removes the coupling. It changes together with
`BACKEND_URL` on the API host; see DEPLOYMENT.md, "Moving to ayeandnay.com",
step 7.
