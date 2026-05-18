import { Hono } from "hono";

const app = new Hono();

// GitHub webhook secret (set via env variable)
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "your-secret-here";
const PORT = process.env.PORT || 3000;
const LOG_FULL_PAYLOAD = process.env.LOG_FULL_PAYLOAD === "true";
const PAYLOAD_PREVIEW_LENGTH = 800;
const MAIN_BRANCHES = new Set(["main", "master"]);
const TASK_BRANCH_SUFFIX_REGEX = /(?:^|[^A-Za-z0-9])T\d+$/;
const TASK_YAML_REGEX = /(?:^|\/)T\d+\.yaml$/;
const REQUIRED_FILES = [
  "status.yaml",
  "product-spec.md",
  "technical-design.md",
  "tasks.md",
];

function getBranchRole(
  branchName?: string,
): "main" | "feature" | "task" | "other" {
  if (!branchName) {
    return "other";
  }

  if (MAIN_BRANCHES.has(branchName)) {
    return "main";
  }

  if (TASK_BRANCH_SUFFIX_REGEX.test(branchName)) {
    return "task";
  }

  return "feature";
}

function getBranchNameFromRef(ref?: string): string | undefined {
  if (!ref) {
    return undefined;
  }

  if (!ref.startsWith("refs/heads/")) {
    return undefined;
  }

  return ref.slice("refs/heads/".length);
}

function collectChangedFiles(commit?: Record<string, unknown>): string[] {
  if (!commit) {
    return [];
  }

  const files = new Set<string>();
  const groups = ["added", "modified", "removed"];

  for (const group of groups) {
    const entries = commit[group as keyof typeof commit];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (typeof entry === "string") {
          files.add(entry);
        }
      }
    }
  }

  return Array.from(files).sort();
}

function matchByBasename(files: string[], target: string): string[] {
  const suffix = `/${target}`;
  return files.filter((file) => file === target || file.endsWith(suffix));
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

    if (event !== "push") {
      console.log(
        `[webhook] ignored event=${event} delivery=${delivery ?? "unknown"}`,
      );
      return c.json(
        {
          success: false,
          message: `Event type "${event}" ignored. Only "push" events are processed.`,
        },
        202,
      );
    }

    const branchName = getBranchNameFromRef(data.ref);

    const branchRole = getBranchRole(branchName);

    if (branchRole === "other") {
      console.log(
        `[webhook] ignored ref=${data.ref ?? "unknown"} event=${event} delivery=${delivery ?? "unknown"}`,
      );
      return c.json(
        {
          success: false,
          message:
            "Ref ignored. Only branch refs (refs/heads/*) for main/feature/task are processed.",
        },
        202,
      );
    }

    const latestCommit =
      typeof data.head_commit === "object" && data.head_commit !== null
        ? (data.head_commit as Record<string, unknown>)
        : undefined;
    const branchUpdateCount =
      typeof data.commits?.length === "number" ? data.commits.length : 0;
    const changedFiles = collectChangedFiles(latestCommit);
    const requiredMatches = REQUIRED_FILES.map((file) => ({
      file,
      matches: matchByBasename(changedFiles, file),
    }));
    const taskYamlMatches = changedFiles.filter((file) =>
      TASK_YAML_REGEX.test(file),
    );

    // Log branch details
    console.log(`\n${"=".repeat(70)}`);
    console.log(`✅ BRANCH PUSH RECEIVED`);
    console.log(`${"=".repeat(70)}`);
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log(`🔑 Delivery ID: ${delivery}`);
    console.log(`📍 Repository: ${data.repository?.full_name}`);
    console.log(`🔗 Repository URL: ${data.repository?.html_url}`);
    console.log(`\n🌿 BRANCH INFO:`);
    console.log(`   🌱 Branch: ${branchName ?? "unknown"}`);
    console.log(`   🏷️ Role: ${branchRole}`);
    console.log(`   📈 Commits in push: ${branchUpdateCount}`);
    console.log(`   👤 Sender: ${data.sender?.login || "unknown"}`);

    console.log(`\n🧾 LATEST COMMIT:`);
    console.log(`   🔑 ID: ${latestCommit?.id || "unknown"}`);
    console.log(`   💬 Message: ${latestCommit?.message || "unknown"}`);
    console.log(`   👤 Author: ${latestCommit?.author?.name || "unknown"}`);

    console.log(`\n📁 FILE CHECK (latest commit):`);
    if (changedFiles.length === 0) {
      console.log("   ⚠️ No file changes found in head_commit");
    }

    for (const item of requiredMatches) {
      const status = item.matches.length > 0 ? "✅" : "❌";
      const detail =
        item.matches.length > 0 ? ` -> ${item.matches.join(", ")}` : "";
      console.log(`   ${status} ${item.file}${detail}`);
    }

    const taskYamlStatus = taskYamlMatches.length > 0 ? "✅" : "❌";
    const taskYamlDetail =
      taskYamlMatches.length > 0 ? ` -> ${taskYamlMatches.join(", ")}` : "";
    console.log(`   ${taskYamlStatus} T*.yaml${taskYamlDetail}`);

    console.log(`${"=".repeat(70)}\n`);

    return c.json({
      success: true,
      event,
      branch: branchName,
      branch_role: branchRole,
      delivery,
      latest_commit: {
        id: latestCommit?.id ?? null,
        message: latestCommit?.message ?? null,
        author: latestCommit?.author ?? null,
        url: latestCommit?.url ?? null,
      },
      files_checked: {
        required: requiredMatches.map((item) => ({
          name: item.file,
          matches: item.matches,
        })),
        task_yaml: taskYamlMatches,
      },
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
