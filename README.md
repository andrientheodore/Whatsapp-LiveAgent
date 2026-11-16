# Live chat widget

A reusable full-page client for the SleekFlow live chat widget, with Cloudflare
Pages Functions for runtime configuration, contact lookup, and conversation notes.
Widget account settings, service URLs, and API keys come from environment
bindings. No customer account identifiers or credentials are included in the
public source.

## Run locally

Use Node.js 22 or later.

```sh
cp .dev.vars.example .dev.vars
# Fill in your own settings in .dev.vars, then:
npm run dev
```

Open http://127.0.0.1:8080/ or http://127.0.0.1:8080/full-view/.
Both URLs serve the full-view chat. The original floating-widget landing page
in `index.html` is retained as source and uses the same runtime configuration,
but is not included in the deployment.

Wrangler loads `.dev.vars` locally. Restart `npm run dev` after changing it;
there is no need to edit HTML or JavaScript or rebuild for configuration changes.
The local file is ignored by Git and excluded from `dist/`.
Opening HTML directly or serving it with a static-only server will not work:
`/api/config` must be served by Pages Functions.

## Configuration

Copy the public widget values from your own SleekFlow embed code. The example
file provides vendor service URLs; change them for your deployment if needed.
Base URLs must use HTTPS, with no credentials, query strings, or fragments.
Trailing slashes are normalized. API paths are appended to the configured base.

| Variable | Purpose |
| --- | --- |
| `SLEEKFLOW_WIDGET_SCRIPT_URL` | Widget JavaScript module URL (`src` from the embed). |
| `SLEEKFLOW_COMPANY_ID` | Your embed's `data-companyid` UUID. Required. |
| `SLEEKFLOW_WIDGET_ID` | Your embed's `data-widgetid` UUID. Required. |
| `SLEEKFLOW_REGION` | Your embed's `data-location`. Required. |
| `SLEEKFLOW_WIDGET_API_BASE_URL` | Widget backend base URL; used for sender verification and observing native submissions. Required. |
| `SLEEKFLOW_API_KEY` | Server-only platform key. Required for contact lookup and notes; optional for manual chat. |
| `SLEEKFLOW_API_BASE_URL` | Platform API base URL for contact lookup and note creation. |
| `SLEEKFLOW_APP_BASE_URL` | Web app base URL, including the locale (for example `/en`), for links in notes. |
| `CONVERSATION_NOTE_LABEL` | Opening text of the internal note. Defaults to `User initiated a live chat conversation`. |
| `CHAT_TITLE` | Full-view widget header title. Defaults to `Live support`. |
| `WELCOME_TITLE` | Welcome panel heading. Defaults to `Hello! Welcome`. |
| `WELCOME_SUBTITLE` | Welcome panel subtitle. Defaults to `Live support`. |
| `WELCOME_NOTE` | Welcome panel footer text. Defaults to `Chat directly with our team`. |
| `HIDE_AGENT_NAMES` | Hides sender name labels in full-view by default. Set to `false` to show them. |

`GET /api/config` returns only an explicit allowlist of public widget and
presentation settings, with caching disabled. It never returns API keys,
platform API settings, or arbitrary environment bindings. Public widget IDs
are visible to visitors as required by the vendor embed. Missing or invalid
widget settings return a generic configuration error.

The full-view adapter replaces the widget header title and can hide sender name
labels. Other vendor-managed content, including avatars, greetings, consent
text, and chat messages, comes from your widget account. Configure that content
in SleekFlow before sharing a deployment. The floating widget retains the
branding configured in your widget account.

## Contact links

Use your own contact UUID:

```text
/full-view/?contact_id=11111111-1111-4111-8111-111111111111
```

The same-origin `/api/contact` function requests
`{SLEEKFLOW_API_BASE_URL}/api/contact/{contact_id}` using the server-side
`SLEEKFLOW_API_KEY` in the vendor's `X-Sleekflow-Api-Key` header. It returns only
first name, last name, phone, and email, with caching disabled.

The adapter fills the native pre-chat form and submits it once when its required
fields are valid. The vendor's validation and consent disclaimer remain intact.
Loading stays visible until the chat composer appears; a rejected submission or
failed/incomplete lookup leaves an editable form. A visitor's edits are never
overwritten. Saved sender sessions are scoped per contact in the iframe.

Contact links let anyone holding the URL load the contact's details and start a
widget session. They do not authenticate the visitor or restore conversation
history across devices. Use this feature only where possession of the link is
an acceptable access policy; this demo does not implement signed or expiring links.

## Conversation notes

Include both your contact UUID and originating conversation UUID:

```text
/full-view/?contact_id=11111111-1111-4111-8111-111111111111&conversation_id=22222222-2222-4222-8222-222222222222
```

After a native form submission, `/api/conversation-note` verifies the signed
sender against the configured widget backend, widget UUID, and region. Once a
conversation and contact exist, it posts a note to the **supplied** conversation
ID using the server-only platform key. The note contains the configured label
and links to the newly created conversation and contact under
`SLEEKFLOW_APP_BASE_URL`. Already-submitted saved sessions can also create a note.
Neither URL parameter is sent to vendor page tracking by the iframe.

Both parameters are required for a note. Successful and uncertain note attempts
are remembered in browser storage per source conversation and sender. Web Locks
serialize concurrent tabs where supported. Uncertain writes are not retried
automatically. There is no deduplication across browsers or cleared storage.
A note failure does not prevent chatting.

The link controls the originating conversation ID. Sender verification does not
establish the visitor's authorization to modify that originating conversation;
add application authorization before using this with untrusted public links.

## Build and deploy

```sh
npm test
npm run build
```

`dist/` contains only public website files. Wrangler compiles `functions/`
separately. `.dev.vars`, tests, Git metadata, and source documentation are never
copied into the website build.

Create your own Cloudflare Pages project. `.dev.vars` is a local file and is not
automatically loaded by a deployed Pages project. You can upload its settings
in bulk, then deploy, without copying values into source code:

```sh
npx wrangler@4.123.0 pages secret bulk .dev.vars --project-name your-project
npx wrangler@4.123.0 pages deploy dist --project-name your-project --branch main
```

Use the actual production branch of your project. Configure preview bindings
separately in Cloudflare if you deploy previews. After changing local settings,
repeat the bulk upload and deploy to apply them remotely. See Cloudflare's
[local binding documentation](https://developers.cloudflare.com/pages/functions/bindings/)
and [bulk secret command](https://developers.cloudflare.com/workers/wrangler/commands/pages/#pages-secret-bulk).
Never upload `.dev.vars` as a public static asset or put the API key in a URL.

The layout adapter depends on the vendor's shadow DOM and XMLHttpRequest
transport. After vendor updates, check automatic opening, native form and consent
validation, contact prefilling/submission, saved-session isolation, note creation,
and mobile layout.

The cleanup covers the current files; Git history and existing deployments are
unchanged. Review those separately before making an existing repository public.
