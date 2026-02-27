const https = require("node:https");

const DEFAULT_TIMEOUT_MS = 5000;

function parseVersion(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.startsWith("v") || raw.startsWith("V") ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+){0,2}$/.test(normalized)) return null;
  const parts = normalized.split(".").map((part) => Number(part));
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersions(left, right) {
  for (let i = 0; i < 3; i += 1) {
    const diff = left[i] - right[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

function isNewerVersion(currentVersion, latestVersion) {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return false;
  return compareVersions(latest, current) > 0;
}

function requestJson(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub API responded with status ${res.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (_error) {
            reject(new Error("Failed to parse GitHub API response"));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("GitHub API request timed out"));
    });
    req.on("error", reject);
  });
}

async function fetchLatestStableRelease({ owner, repo, appVersion, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!owner || !repo) throw new Error("Repository owner and repo are required");

  const endpoint = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const releases = await requestJson(
    endpoint,
    {
      Accept: "application/vnd.github+json",
      "User-Agent": `Data Manager/${appVersion || "unknown"}`
    },
    timeoutMs
  );

  if (!Array.isArray(releases)) throw new Error("Unexpected releases payload");

  const stableReleases = releases.filter((release) => release && !release.draft && !release.prerelease);
  for (const release of stableReleases) {
    const tagVersion = String(release.tag_name || "").trim();
    if (!parseVersion(tagVersion)) continue;
    return {
      tagVersion,
      htmlUrl: String(release.html_url || ""),
      name: String(release.name || ""),
      publishedAt: String(release.published_at || "")
    };
  }

  return null;
}

async function checkForUpdate({ currentVersion, owner, repo, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const parsedCurrent = parseVersion(currentVersion);
  if (!parsedCurrent) return { status: "skip", reason: "Invalid current version" };

  try {
    const latestRelease = await fetchLatestStableRelease({
      owner,
      repo,
      appVersion: currentVersion,
      timeoutMs
    });
    if (!latestRelease) return { status: "skip", reason: "No stable release found" };

    if (!isNewerVersion(currentVersion, latestRelease.tagVersion)) {
      return { status: "up-to-date" };
    }

    return {
      status: "update-available",
      latestVersion: latestRelease.tagVersion,
      releaseUrl: latestRelease.htmlUrl,
      releaseName: latestRelease.name,
      publishedAt: latestRelease.publishedAt
    };
  } catch (error) {
    return { status: "skip", reason: error?.message || "Unknown update check error" };
  }
}

module.exports = {
  checkForUpdate,
  isNewerVersion,
  parseVersion
};
