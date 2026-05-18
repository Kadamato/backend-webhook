# GitHub Webhook Backend

A minimal backend API built with Bun and Hono to listen for GitHub **pull request events**.

## Features

✅ Listens only to pull request events  
✅ Logs all PR-related details (commits, changes, authors, etc.)  
✅ HMAC-SHA256 signature verification  
✅ Built with Hono and Bun  
✅ TypeScript support  
✅ Single `POST` webhook endpoint

## Setup

### Prerequisites

- [Bun](https://bun.sh) installed

### Installation

```bash
bun install
```

### Environment Variables

Set environment variables:

```bash
export GITHUB_WEBHOOK_SECRET="your-webhook-secret"
export PORT=3000
```

Or create a `.env` file:

```env
GITHUB_WEBHOOK_SECRET=your-webhook-secret
PORT=3000
```

**Note:** The webhook secret must match the secret configured in your GitHub repository settings.

## Running

### Development (with watch mode)

```bash
bun run dev
```

### Production

```bash
bun start
```

The server starts on `http://localhost:3000` by default.

## Docker

### Build Docker Image

```bash
docker build -t github-webhook:latest .
```

### Run with Docker

```bash
# Basic run
docker run -p 3000:3000 \
  -e GITHUB_WEBHOOK_SECRET="your-secret" \
  github-webhook:latest

# With environment file
docker run -p 3000:3000 \
  --env-file .env \
  github-webhook:latest
```

### Docker Compose (Recommended)

```bash
# Start service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop service
docker-compose down
```

Create `.env` file for docker-compose:

```env
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

### Health Check

Docker automatically checks health every 30 seconds:

```bash
# Check manually
curl http://localhost:3000/health
```

## API Endpoints

### Pull Request Webhook Receiver

```bash
POST /webhook/github
```

**Accepts only `pull_request` events**

Required Headers (sent automatically by GitHub):

- `X-Hub-Signature-256`: GitHub's HMAC signature
- `X-GitHub-Event`: Must be `pull_request`

### Health Check

```bash
GET /health
```

Response: `{ "status": "ok" }`

## GitHub Webhook Setup

1. Go to your GitHub repository → **Settings** → **Webhooks**
2. Click **Add webhook**
3. **Payload URL:** `https://your-domain.com/webhook/github`
4. **Content type:** `application/json`
5. **Secret:** Use a strong secret (store as `GITHUB_WEBHOOK_SECRET`)
6. **Which events would you like to trigger this webhook?** → Select only **Pull requests**
7. Click **Add webhook**

## Logged PR Details

The webhook logs comprehensive pull request information:

```
======================================================================
✅ PULL REQUEST EVENT RECEIVED
======================================================================
📅 Timestamp: 2026-05-18T10:30:00.000Z
🔑 Delivery ID: 12345-67890
📍 Repository: octocat/Hello-World
🔗 Repository URL: https://github.com/octocat/Hello-World

📋 PULL REQUEST DETAILS:
   🔢 PR Number: #42
   📝 Title: Add new feature
   ⚡ Action: opened
   📊 State: open
   👤 Author: octocat
   🔀 Head Branch: feature/new-feature
   🔀 Base Branch: main
   📈 Commits: 5
   ➕ Additions: 123
   ➖ Deletions: 45
   📁 Changed Files: 8
   💬 Comments: 2
   👍 Approvals: 0

🎉 NEW PR OPENED
======================================================================
```

## Supported PR Actions

The webhook captures different pull request actions:

- `opened` — New PR created
- `closed` — PR closed (includes merge status)
- `reopened` — PR reopened
- `synchronize` — New commits pushed to PR
- `ready_for_review` — Draft PR marked ready
- `converted_to_draft` — PR converted to draft
- `edited` — PR title/description updated
- `approved` — PR approved
- `review_requested` — Reviewer requested
- `auto_merge_enabled` / `auto_merge_disabled` — Auto-merge status
- And more...

## Response

Successful response:

```json
{
  "success": true,
  "event": "pull_request",
  "action": "opened",
  "pr_number": 42,
  "pr_title": "Add new feature",
  "delivery": "12345-67890",
  "processed_at": "2026-05-18T10:30:00.000Z"
}
```

## Testing with ngrok

To test locally:

```bash
# Terminal 1: Start the server
bun run dev

# Terminal 2: Expose with ngrok
ngrok http 3000

# Use the ngrok URL as your GitHub webhook payload URL
```

## Non-PR Events

Other event types (push, issues, release, etc.) will receive a 202 response:

```json
{
  "success": false,
  "message": "Event type \"push\" ignored. Only \"pull_request\" events are processed."
}
```

## License

MIT
