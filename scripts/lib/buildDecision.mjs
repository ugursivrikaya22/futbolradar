import { execFileSync } from "node:child_process";

const RETIRED_PROJECTS = new Set([
  "prj_YsUzZ709WK4AuHOxTSNjyKIk37nR",
  "prj_gCBePx6FI4pstOGVedAfakovRQjN"
]);

// Only private operational files are ignored. Unknown paths, public content,
// SEO files, source code and configuration always require a build.
export function isOperationalOnly(file) {
  return /^(?:docs\/|outputs\/|editorial\/|\.github\/)/.test(file)
    || /^(?:README|AGENTS)\.md$/i.test(file);
}

export function buildDecision(env = process.env, cwd = process.cwd()) {
  if (RETIRED_PROJECTS.has(env.VERCEL_PROJECT_ID)) return { build: false, reason: "retired project" };
  const branch = env.VERCEL_GIT_COMMIT_REF || "";
  if (env.VERCEL_ENV === "preview" && branch && !/^preview\/.+/.test(branch)) {
    return { build: false, reason: "preview builds are opt-in on preview/* branches; production remains enabled" };
  }
  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  const current = env.VERCEL_GIT_COMMIT_SHA;
  if (!/^[a-f0-9]{40}$/i.test(previous || "") || !/^[a-f0-9]{40}$/i.test(current || "")) {
    return { build: true, reason: "deployment comparison unavailable" };
  }
  try {
    const files = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", previous, current, "--"], {
      cwd, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
    }).split("\0").filter(Boolean);
    return files.every(isOperationalOnly)
      ? { build: false, reason: "no public or runtime changes since previous deployment" }
      : { build: true, reason: "public content, configuration or runtime changed" };
  } catch {
    return { build: true, reason: "comparison failed; preserve publication" };
  }
}
