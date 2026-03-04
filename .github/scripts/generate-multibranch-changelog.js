const { Octokit } = require("@octokit/rest");
const semver = require("semver");
const fs = require('fs');

const owner = "Mesa-de-Pagos";
const repo = "api-partner";
const token = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: token });

const branch = "main";
const prBranchPrefixes = [
  { prefix: "breaking/", cat: "Breaking changes" },
  { prefix: "feature/", cat: "Features" },
  { prefix: "fix/", cat: "Fixes" },
  { prefix: "hotfix/", cat: "Hotfixes" },
  { prefix: "bug/", cat: "Bugs" },
  { prefix: "docs/", cat: "Docs" },
  { prefix: "refactor/", cat: "Refactor" },
  { prefix: "feat/", cat: "Features" }
];

const categoryEmojis = {
  "Breaking changes": "💥",
  "Features": "🚀",
  "Fixes": "🐛",
  "Hotfixes": "🔥",
  "Bugs": "🕷️",
  "Docs": "📚",
  "Refactor": "🛠️"
};

// Detecta el último tag semver válido y calcula la siguiente versión (minor por default)
async function getNextVersion() {
  const tags = await octokit.repos.listTags({ owner, repo, per_page: 10 });
  const versions = tags.data
    .map(t => semver.valid(semver.clean(t.name)))
    .filter(Boolean)
    .sort(semver.rcompare);

  const latest = versions.length ? versions[0] : "0.1.0";
  const next = semver.inc(latest, "minor");
  return { latest, next, sha: tags.data.length ? tags.data[0].commit.sha : null };
}

async function getPRsMergedIntoMainSince(lastTagSha) {
  const commits = await octokit.repos.compareCommits({
    owner,
    repo,
    base: lastTagSha,
    head: branch,
  });

  const prNumbers = commits.data.commits
    .map(c => c.commit.message.match(/Merge pull request #(\d+)/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));

  const prs = await Promise.all(prNumbers.map(num =>
    octokit.pulls.get({ owner, repo, pull_number: num })
  ));

  // Detecta categoría por label actual o prefijo de rama
  return prs
    .map(pr => pr.data)
    .map(pr => {
      if (pr.labels.some(l => l.name.toLowerCase() === "breaking")) {
        return { ...pr, category: "Breaking changes" };
      }
      const found = prBranchPrefixes.find(p => pr.head.ref.startsWith(p.prefix));
      return found ? { ...pr, category: found.cat } : null;
    })
    .filter(Boolean);
}

function uniquePRs(prs) {
  const seen = {};
  return prs.filter(pr => {
    if (seen[pr.number]) return false;
    seen[pr.number] = true;
    return true;
  });
}

function groupByCategory(prs) {
  const groups = {};
  for (const pr of prs) {
    if (!groups[pr.category]) groups[pr.category] = [];
    groups[pr.category].push(pr);
  }
  return groups;
}

async function main() {
  if (!token) throw new Error("Debes exportar tu GITHUB_TOKEN en el ambiente");
  const { latest, next, sha: lastTagSha } = await getNextVersion();

  if (!lastTagSha) {
    console.log("No hay tags previos; changelog vacío.");
    return;
  }

  let allPRs = await getPRsMergedIntoMainSince(lastTagSha);
  allPRs = uniquePRs(allPRs);

  const grouped = groupByCategory(allPRs);

  let notes = `# 🚀 Release Notes v${next}\n\n`;
  notes += `## Changes from v${latest}\n\n`;

  for (const cat of Object.keys(grouped)) {
    const emoji = categoryEmojis[cat] || "";
    notes += `### ${emoji} ${cat}\n`;
    for (const pr of grouped[cat]) {
      notes += `- ${pr.title} (#${pr.number}) @${pr.user.login}\n`;
    }
    notes += "\n";
  }

  console.log(notes);
  fs.writeFileSync('version.txt', next);
}

main().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
