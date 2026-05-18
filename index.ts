import { Hono } from "hono";

const app = new Hono();

// GitHub webhook secret (set via env variable)
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "your-secret-here";
const PORT = process.env.PORT || 3000;

/**
 * Verify GitHub webhook signature
 * GitHub sends: X-Hub-Signature-256 header with format: sha256=<signature>
 */
async function verifyGitHubSignature(
  payload: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  const calculatedSignature =
    "sha256=" +
    Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return calculatedSignature === signature;
}

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// GitHub webhook endpoint - listens only to pull_request events
app.post("/webhook/github", async (c) => {
  try {
    const payload = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    const event = c.req.header("x-github-event");
    const delivery = c.req.header("x-github-delivery");

    if (!signature) {
      return c.json({ error: "Missing signature" }, 401);
    }

    // Only accept pull_request events
    if (event !== "pull_request") {
      return c.json(
        {
          success: false,
          message: `Event type "${event}" ignored. Only "pull_request" events are processed.`,
        },
        202,
      );
    }

    // Verify signature
    const isValid = await verifyGitHubSignature(payload, signature);
    if (!isValid) {
      console.warn("❌ Invalid webhook signature");
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Parse the JSON payload
    const data = JSON.parse(payload);
    const pr = data.pull_request;

    // Log pull request details
    console.log(`\n${"=".repeat(70)}`);
    console.log(`✅ PULL REQUEST EVENT RECEIVED`);
    console.log(`${"=".repeat(70)}`);
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log(`🔑 Delivery ID: ${delivery}`);
    console.log(`📍 Repository: ${data.repository?.full_name}`);
    console.log(`🔗 Repository URL: ${data.repository?.html_url}`);
    console.log(`\n📋 PULL REQUEST DETAILS:`);
    console.log(`   🔢 PR Number: #${pr?.number}`);
    console.log(`   📝 Title: ${pr?.title}`);
    console.log(`   ⚡ Action: ${data.action}`);
    console.log(`   📊 State: ${pr?.state}`);
    console.log(`   👤 Author: ${pr?.user?.login}`);
    console.log(`   🔀 Head Branch: ${pr?.head?.ref}`);
    console.log(`   🔀 Base Branch: ${pr?.base?.ref}`);
    console.log(`   📈 Commits: ${pr?.commits}`);
    console.log(`   ➕ Additions: ${pr?.additions}`);
    console.log(`   ➖ Deletions: ${pr?.deletions}`);
    console.log(`   📁 Changed Files: ${pr?.changed_files}`);
    console.log(`   💬 Comments: ${pr?.comments}`);
    console.log(`   👍 Approvals: ${pr?.approved_by?.login || 0}`);

    if (pr?.description) {
      console.log(`   📄 Description: ${pr.body?.substring(0, 100)}...`);
    }

    if (data.action === "opened") {
      console.log(`\n🎉 NEW PR OPENED`);
    } else if (data.action === "closed") {
      console.log(`\n🔒 PR CLOSED`);
      if (pr?.merged) {
        console.log(`   ✅ MERGED by: ${pr.merged_by?.login}`);
      }
    } else if (data.action === "reopened") {
      console.log(`\n🔄 PR REOPENED`);
    } else if (data.action === "synchronize") {
      console.log(`\n🔄 NEW COMMITS PUSHED`);
    } else if (data.action === "ready_for_review") {
      console.log(`\n✅ READY FOR REVIEW`);
    } else if (data.action === "converted_to_draft") {
      console.log(`\n📝 CONVERTED TO DRAFT`);
    }

    console.log(`${"=".repeat(70)}\n`);

    return c.json({
      success: true,
      event,
      action: data.action,
      pr_number: pr?.number,
      pr_title: pr?.title,
      delivery,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Start server
console.log(`🚀 Server starting on http://localhost:${PORT}`);
console.log(
  `📝 Webhook endpoint: POST http://localhost:${PORT}/webhook/github`,
);
console.log(`💚 Health check: GET http://localhost:${PORT}/health`);
console.log(
  `🔐 Using webhook secret: ${WEBHOOK_SECRET === "your-secret-here" ? "⚠️ DEFAULT (change me!)" : "✓ Set from GITHUB_WEBHOOK_SECRET"}`,
);

export default {
  port: PORT,
  fetch: app.fetch,
};
