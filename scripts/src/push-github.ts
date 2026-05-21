import fs from "node:fs";
import path from "node:path";

const WORKSPACE = "/home/runner/workspace";
const REPO = "xoshimaljon-crypto/bekmarket-bot";
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = "main";

if (!TOKEN) throw new Error("GITHUB_TOKEN not set");

const EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  ".local",
  "dist",
  ".cache",
  "pnpm",
];

const EXCLUDE_FILES = [
  "scripts/src/push-github.ts",
  "scripts/push-to-github.sh",
  "pnpm-lock.yaml",
];

const EXCLUDE_EXTENSIONS = [".map", ".tsbuildinfo"];

function shouldExclude(filePath: string, isDir: boolean): boolean {
  const rel = path.relative(WORKSPACE, filePath);
  const base = path.basename(filePath);
  if (isDir) {
    return EXCLUDE_DIRS.includes(base);
  }
  if (EXCLUDE_FILES.includes(rel)) return true;
  if (EXCLUDE_EXTENSIONS.some((ext) => rel.endsWith(ext))) return true;
  return false;
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldExclude(full, true)) continue;
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      if (shouldExclude(full, false)) continue;
      results.push(full);
    }
  }
  return results;
}

async function ghFetch(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

async function getRefSha(): Promise<string | null> {
  const { status, data } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/ref/heads/${BRANCH}`
  );
  if (status === 200) {
    return ((data as { object?: { sha?: string } }).object?.sha) ?? null;
  }
  return null;
}

async function createBlob(content: string): Promise<string> {
  const { status, data } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/blobs`,
    "POST",
    { content, encoding: "base64" }
  );
  if (status !== 201) throw new Error(`createBlob failed: ${status} ${JSON.stringify(data)}`);
  return (data as { sha: string }).sha;
}

async function createTree(
  entries: Array<{ path: string; sha: string }>,
  baseTree?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    tree: entries.map(({ path: p, sha }) => ({
      path: p,
      mode: "100644",
      type: "blob",
      sha,
    })),
  };
  if (baseTree) body.base_tree = baseTree;
  const { status, data } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/trees`,
    "POST",
    body
  );
  if (status !== 201) throw new Error(`createTree failed: ${status} ${JSON.stringify(data)}`);
  return (data as { sha: string }).sha;
}

async function createCommit(
  message: string,
  treeSha: string,
  parents: string[]
): Promise<string> {
  const { status, data } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/commits`,
    "POST",
    { message, tree: treeSha, parents }
  );
  if (status !== 201) throw new Error(`createCommit failed: ${status} ${JSON.stringify(data)}`);
  return (data as { sha: string }).sha;
}

async function upsertRef(commitSha: string, force = true): Promise<void> {
  // Try PATCH first (update existing ref)
  const { status, data } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}`,
    "PATCH",
    { sha: commitSha, force }
  );
  if (status === 200) return;
  // If 422, ref doesn't exist — create it
  const { status: s2, data: d2 } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/refs`,
    "POST",
    { ref: `refs/heads/${BRANCH}`, sha: commitSha }
  );
  if (s2 !== 201) throw new Error(`upsertRef failed: ${s2} ${JSON.stringify(d2)}`);
}

// Initialize empty repo by creating an empty commit first via Contents API
async function initializeRepo(): Promise<void> {
  console.log("Initializing empty repo with a README...");
  const { status } = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/README.md`,
    "PUT",
    {
      message: "chore: initialize repository",
      content: Buffer.from("# Bek Market HR Bot\n").toString("base64"),
      branch: BRANCH,
    }
  );
  if (status !== 201) throw new Error(`Failed to initialize repo`);
}

async function main() {
  const files = collectFiles(WORKSPACE);
  console.log(`Found ${files.length} files to push`);

  // Check if repo has any commits
  let parentSha = await getRefSha();
  let baseTreeSha: string | undefined;

  if (!parentSha) {
    // Repo is empty — initialize it first
    await initializeRepo();
    // Now we can get the ref
    parentSha = await getRefSha();
    if (!parentSha) throw new Error("Could not get ref after initialization");
  }

  // Get the tree SHA of the current commit
  const { data: commitData } = await ghFetch(
    `https://api.github.com/repos/${REPO}/git/commits/${parentSha}`
  );
  baseTreeSha = ((commitData as { tree?: { sha?: string } }).tree?.sha);

  console.log(`Parent commit: ${parentSha.slice(0, 8)}, base tree: ${baseTreeSha?.slice(0, 8)}`);

  // Upload blobs in parallel batches
  const BATCH = 8;
  const entries: Array<{ path: string; sha: string }> = [];

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        const relPath = path.relative(WORKSPACE, filePath);
        const raw = fs.readFileSync(filePath);
        const b64 = raw.toString("base64");
        const sha = await createBlob(b64);
        process.stdout.write(`  ✓ ${relPath}\n`);
        return { path: relPath, sha };
      })
    );
    entries.push(...results);
    console.log(`Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(files.length / BATCH)} done`);
  }

  console.log(`\nCreating tree with ${entries.length} entries...`);
  const treeSha = await createTree(entries, baseTreeSha);

  console.log("Creating commit...");
  const commitSha = await createCommit(
    "feat: initial project export — Bek Market HR Telegram Bot\n\nFull pnpm monorepo with Express API server, Telegram bot, OpenAI integration, and PostgreSQL session storage.",
    treeSha,
    [parentSha]
  );

  console.log("Updating branch ref...");
  await upsertRef(commitSha);

  console.log(`\nDone! Repository: https://github.com/${REPO}/tree/${BRANCH}`);
  console.log(`Commit: ${commitSha}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
