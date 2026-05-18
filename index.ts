import { Hono } from "hono";

const app = new Hono();

// GitHub webhook secret (set via env variable)
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "your-secret-here";
const PORT = process.env.PORT || 3000;
const LOG_FULL_PAYLOAD = process.env.LOG_FULL_PAYLOAD === "true";
const PAYLOAD_PREVIEW_LENGTH = 800;
const FEATURE_BRANCH_NAME = "feature/workspace-data-backend";
const TASK_BRANCH_PREFIX = "feature/workspace-data-backend-T";

function getBranchRole(branchName?: string): "feature" | "task" | "other" {
  if (!branchName) {
    return "other";
  }

  if (branchName === FEATURE_BRANCH_NAME) {
    return "feature";
  }

  if (branchName.startsWith(TASK_BRANCH_PREFIX)) {
    return "task";
  }

  return "other";
}

function getBranchNameFromRef(ref?: string): string | undefined {
  if (!ref) {
    return undefined;
  }

  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

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

// GitHub webhook endpoint - listens to branch created/updated events
app.post("/webhook/github", async (c) => {
  try {
    const payload = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    const event = c.req.header("x-github-event");
    const delivery = c.req.header("x-github-delivery");

    console.log(
      `[webhook] incoming event=${event ?? "unknown"} delivery=${delivery ?? "unknown"} bytes=${payload.length}`,
    );

    if (!event) {
      return c.json({ error: "Missing event header" }, 400);
    }

    if (!signature) {
      console.warn(
        `[webhook] missing signature delivery=${delivery ?? "unknown"}`,
      );
      return c.json({ error: "Missing signature" }, 401);
    }

    // Verify signature
    const isValid = await verifyGitHubSignature(payload, signature);
    if (!isValid) {
      console.warn(
        `[webhook] invalid signature event=${event} delivery=${delivery ?? "unknown"}`,
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (LOG_FULL_PAYLOAD) {
      console.log(`[webhook] payload(full): ${payload}`);
    } else {
      const preview =
        payload.length > PAYLOAD_PREVIEW_LENGTH
          ? `${payload.slice(0, PAYLOAD_PREVIEW_LENGTH)}...`
          : payload;
      console.log(`[webhook] payload(preview): ${preview}`);
    }

    let data: Record<string, any>;
    try {
      data = JSON.parse(payload) as Record<string, any>;
    } catch {
      console.warn(
        `[webhook] invalid JSON body event=${event} delivery=${delivery ?? "unknown"}`,
      );
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const action = typeof data.action === "string" ? data.action : "unknown";
    const repoName =
      typeof data.repository?.full_name === "string"
        ? data.repository.full_name
        : "unknown";

    console.log(`[webhook] parsed repo=${repoName} action=${action}`);

    const branchName =
      event === "push"
        ? getBranchNameFromRef(data.ref)
        : event === "create"
          ? typeof data.ref === "string"
            ? data.ref
            : undefined
          : undefined;

    const branchRole = getBranchRole(branchName);

    if (branchRole === "other") {
      console.log(
        `[webhook] ignored branch=${branchName ?? "unknown"} event=${event} delivery=${delivery ?? "unknown"}`,
      );
      return c.json(
        {
          success: false,
          message: `Branch "${branchName ?? "unknown"}" ignored. Only feature/task branches are processed.`,
        },
        202,
      );
    }

    if (event !== "create" && event !== "push") {
      console.log(
        `[webhook] ignored event=${event} branch=${branchName ?? "unknown"} delivery=${delivery ?? "unknown"}`,
      );
      return c.json(
        {
          success: false,
          message: `Event type "${event}" ignored. Only "create" and "push" events are processed.`,
        },
        202,
      );
    }

    const featureBranch =
      branchRole === "feature" ? branchName : FEATURE_BRANCH_NAME;
    const taskBranch = branchRole === "task" ? branchName : branchName;
    const featureBranchRole = getBranchRole(featureBranch);
    const taskBranchRole = getBranchRole(taskBranch);
    const branchState = event === "create" ? "created" : "updated";
    const branchUpdateCount =
      event === "push" && typeof data.commits?.length === "number"
        ? data.commits.length
        : undefined;

    // Log branch details
    console.log(`\n${"=".repeat(70)}`);
    console.log(`✅ BRANCH EVENT RECEIVED`);
    console.log(`${"=".repeat(70)}`);
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log(`🔑 Delivery ID: ${delivery}`);
    console.log(`📍 Repository: ${data.repository?.full_name}`);
    console.log(`🔗 Repository URL: ${data.repository?.html_url}`);
    console.log(`\n📋 BRANCH DETAILS:`);
    console.log(`   🧩 Feature Branch: ${featureBranch || "unknown"}`);
    console.log(`   🧩 Feature Branch Role: ${featureBranchRole}`);
    console.log(`   🛠️ Task Branch: ${taskBranch || "unknown"}`);
    console.log(`   🛠️ Task Branch Role: ${taskBranchRole}`);
    console.log(`   ⚡ Event: ${event}`);
    console.log(`   📌 State: ${branchState}`);
    console.log(`   📈 Commits: ${branchUpdateCount ?? 0}`);
    console.log(`   👤 Sender: ${data.sender?.login || "unknown"}`);

    if (event === "create") {
      console.log(`\n🎉 BRANCH CREATED`);
      console.log(`   🌱 New branch: ${branchName}`);
    } else if (event === "push") {
      console.log(`\n🔄 BRANCH UPDATED`);
      console.log(`   🌱 Branch: ${branchName}`);
      console.log(
        `   🧾 Latest commit: ${data.head_commit?.message || "unknown"}`,
      );
      console.log(
        `   👤 Committer: ${data.head_commit?.author?.name || "unknown"}`,
      );
    }

    console.log(`${"=".repeat(70)}\n`);

    return c.json({
      success: true,
      event,
      state: branchState,
      branch: branchName,
      branch_role: branchRole,
      feature_branch: featureBranch,
      task_branch: taskBranch,
      delivery,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
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
