# Tacit

Tacit is Caleb Ventura's personal AI — a Next.js web app where visitors can talk to an AI trained to be Caleb, and where Caleb can manage his life by chatting with an owner agent that has access to his documents, Gmail, and external tools.

---

## What this is

Two things in one codebase:

**A public-facing chat interface.** Anyone who knows Caleb can open the site, answer "how do you know me?", and have a conversation with an AI that knows his background, values, projects, and story. It's a living personal presence — smarter than a bio, more personal than a portfolio.

**An owner agent.** Caleb opens the same UI in owner mode and talks to a second Claude agent that can read his Gmail, search his uploaded documents, draft email replies, and manage MCP connectors. Everything through natural language, no separate dashboards.

---

## What's been built

### Visitor chat
- Gate screen ("how do you know me?") that seeds the conversation with context about who the visitor is
- Full SSE streaming chat with Claude claude-sonnet-4-6 using a custom system prompt shaped like Caleb
- Suggested question chips on first open

### Owner mode
- A separate Claude agent with 9 tools, activated when Caleb is authenticated
- **read_gmail** — searches Gmail with full Gmail syntax, returns sender/subject/snippet/date/unread
- **handle_email** — full triage pipeline: reads an email thread, searches the document store for relevant pages, classifies the email (actionable / needs your call / ignore), drafts a reply grounded in the matched documents, returns a structured proposal card
- **search_documents** — full-text + FTS fallback search across uploaded PDFs
- **list_mcp_connectors / toggle_mcp_connector / set_connector_lane** — manages MCP server connections and routing lanes
- **get_connector_status / toggle_connector** — manages other integrations

### Email proposal card
- When handle_email runs, the response renders as a rich UI card, not a plain text bubble
- Shows: classification badge, the agent's reason, grounded-in citations with page excerpts and green left-border styling, an editable draft reply textarea, and suggested attachments
- Approve button logs the action to the owner actions table; Skip dismisses the card
- No email is sent yet — approval is the logging step before email send is wired

### Document management
- PDF upload via the "+" menu in the composer
- **ingestPdf** pipeline: pdf-parse for text extraction → pdfjs-dist + @napi-rs/canvas + tesseract.js for OCR on sparse pages (< 20 chars extracted) → store per-page rows in `document_pages` with `ocr_used` flag
- Hybrid FTS search: `websearch_to_tsquery` for primary AND-match, falls back to `to_tsquery` OR-match with 0.7 score weight — finds documents even when the email doesn't use the exact terminology from the PDF

### Gmail OAuth
- OAuth 2.0 connect flow through `/api/owner/gmail/connect`
- Token stored encrypted in Supabase, refreshed on demand
- Read-only scope

### Design
- Light-only theme: white base (`#FFFFFF`), off-white card surfaces (`#F5F4F2`), near-black text (`#1A1A1A`), deep green accent (`#15803D`)
- `color-scheme: light` — OS dark mode has no effect
- Hairline borders (0.5px), two font weights (400/500), sentence case throughout
- Monospace for page numbers, source counts, and the wordmark

---

## The goal

Tacit should feel like talking to Caleb — not a chatbot, not a portfolio page. For visitors: a way to actually get to know him that scales and is available at any hour. For Caleb: an agent that handles the operational overhead of his life so he can focus on work only he can do.

Long-term, the owner agent becomes a general executive assistant — it reads the inbox, understands Caleb's documents, drafts responses, and eventually takes actions on his behalf with a single approval tap.

---

## What remains

**Email sending.** The proposal card exists and approval is logged, but no email goes out. Next step: `/api/owner/email/send` route that calls the Gmail API to send the approved draft from Caleb's account.

**Inbox push integration.** Today Caleb has to ask the agent to read mail. Next step: Gmail pub/sub webhook so new emails automatically trigger handle_email and surface as proposal cards without prompting.

**Broader tool coverage.** Scheduling, reminders, task management, calendar. The MCP connector infrastructure is already there; it's a matter of wiring in more tools.

**Public-facing improvements.** The gate is minimal. Room for a richer intro, a way to surface Caleb's current projects, or a publicly browsable document viewer.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind v4 (`@theme inline`) |
| Database | Supabase Postgres (service_role) |
| AI | Anthropic claude-sonnet-4-6 via `@anthropic-ai/sdk` |
| PDF text | pdf-parse v2 |
| PDF render | pdfjs-dist v5 (legacy build) |
| Canvas | @napi-rs/canvas |
| OCR | tesseract.js v7 |
| Email | Gmail API (OAuth 2.0, read-only) |
| Session | Iron Session (JWT cookie) |

---

## Setup

```bash
npm install
```

Create `.env.local` (never committed):

```
# Required
ANTHROPIC_API_KEY=your-key-here

# Owner auth
OWNER_PASSWORD=your-strong-password-here
SESSION_SECRET=your-64-char-hex-secret-here

# Supabase (required for documents, visitors, owner tools)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
ENCRYPTION_KEY=your-64-char-hex-encryption-key-here

# Gmail OAuth (required for read_gmail and handle_email)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/owner/gmail/callback
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Supabase setup:**

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration files in `supabase/` in order through the SQL Editor
3. Copy Project URL → `SUPABASE_URL`
4. Copy service_role key → `SUPABASE_SERVICE_ROLE_KEY`

```bash
npm run dev   # http://localhost:3000
npm run build # production build check
```

## Deploy

Import to Vercel and add the variables above as environment variables (Settings → Environment Variables).
