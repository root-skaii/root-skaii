// Generates the midnight-themed stats, top languages and activity cards into assets/.
// Runs in GitHub Actions (see .github/workflows/cards.yml). Needs GITHUB_TOKEN.
import { writeFile, mkdir } from "node:fs/promises";

const LOGIN = process.env.LOGIN || "root-skaii";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = new URL("../assets/", import.meta.url);

const C = {
  bgA: "#1b2042",
  bgB: "#11152b",
  border: "#2e3360",
  title: "#c9c5f5",
  text: "#aab0cc",
  muted: "#6f7599",
  accent: "#8f8ae0",
  bright: "#e6e9f5",
  shades: ["#b9b4ee", "#8f8ae0", "#6c74c9", "#4f5aa8", "#3a4280", "#2c3263"],
};
const FONT = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif"`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

const frame = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bgA}"/><stop offset="1" stop-color="${C.bgB}"/></linearGradient></defs>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="url(#bg)" stroke="${C.border}"/>
<text x="24" y="36" ${FONT} font-size="15" font-weight="600" fill="${C.title}">${esc(title)}</text>
${body}
</svg>`;

async function fetchData() {
  if (process.env.SAMPLE) return sampleData();
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");
  const query = `query($login: String!) {
    user(login: $login) {
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
        }
      }
      contributionsCollection {
        totalCommitContributions
        restrictedContributionsCount
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

function statsCard(u) {
  const cc = u.contributionsCollection;
  const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  const rows = [
    ["contributions this year", cc.contributionCalendar.totalContributions],
    ["commits this year", cc.totalCommitContributions + cc.restrictedContributionsCount],
    ["pull requests", u.pullRequests.totalCount],
    ["issues", u.issues.totalCount],
    ["stars earned", stars],
    ["repositories", u.repositories.totalCount],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 68 + i * 24;
      return `<circle cx="28" cy="${y - 4}" r="3" fill="${C.shades[i % 3]}"/>
<text x="42" y="${y}" ${FONT} font-size="13" fill="${C.text}">${label}</text>
<text x="336" y="${y}" ${FONT} font-size="13" font-weight="600" fill="${C.bright}" text-anchor="end">${fmt(value)}</text>`;
    })
    .join("\n");
  return frame(360, 210, "stats", body);
}

function langsCard(u) {
  const sizes = new Map();
  for (const repo of u.repositories.nodes)
    for (const { size, node } of repo.languages.edges) sizes.set(node.name, (sizes.get(node.name) || 0) + size);
  const total = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
  const top = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const barW = 312;
  let x = 24;
  const bar = top
    .map(([, size], i) => {
      const w = (size / total) * barW;
      const seg = `<rect x="${x}" y="54" width="${Math.max(w, 2)}" height="8" fill="${C.shades[i]}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = top
    .map(([name, size], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = 24 + col * 160, ly = 92 + row * 26;
      return `<circle cx="${lx + 4}" cy="${ly - 4}" r="4" fill="${C.shades[i]}"/>
<text x="${lx + 14}" y="${ly}" ${FONT} font-size="13" fill="${C.text}">${esc(name)}</text>
<text x="${lx + 146}" y="${ly}" ${FONT} font-size="12" fill="${C.muted}" text-anchor="end">${((size / total) * 100).toFixed(1)}%</text>`;
    })
    .join("\n");
  const body = `<clipPath id="bar"><rect x="24" y="54" width="${barW}" height="8" rx="4"/></clipPath>
<rect x="24" y="54" width="${barW}" height="8" rx="4" fill="${C.border}"/>
<g clip-path="url(#bar)">${bar}</g>
${legend}`;
  return frame(360, 210, "top languages", body);
}

function activityCard(u) {
  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays).slice(-60);
  const W = 760, H = 240, L = 48, R = 24, T = 60, B = 40;
  const max = Math.max(4, ...days.map((d) => d.contributionCount));
  const step = (W - L - R) / (days.length - 1);
  const pts = days.map((d, i) => [L + i * step, T + (1 - d.contributionCount / max) * (H - T - B)]);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)[0].toFixed(1)} ${H - B} L${L} ${H - B} Z`;

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = T + (1 - f) * (H - T - B);
      return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${C.border}" stroke-dasharray="3 5"/>
<text x="${L - 10}" y="${y + 4}" ${FONT} font-size="11" fill="${C.muted}" text-anchor="end">${Math.round(max * f)}</text>`;
    })
    .join("\n");
  const labels = [0, Math.floor(days.length / 2), days.length - 1]
    .map((i, k) => {
      const d = new Date(days[i].date + "T00:00:00Z");
      const text = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toLowerCase();
      const anchor = ["start", "middle", "end"][k];
      return `<text x="${pts[i][0]}" y="${H - 14}" ${FONT} font-size="11" fill="${C.muted}" text-anchor="${anchor}">${text}</text>`;
    })
    .join("\n");
  const body = `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.accent}" stop-opacity=".35"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></linearGradient></defs>
${grid}
<path d="${area}" fill="url(#fade)"/>
<path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
${labels}`;
  return frame(W, H, "last 60 days", body);
}

function sampleData() {
  const start = Date.UTC(2026, 0, 1);
  const days = Array.from({ length: 371 }, (_, i) => ({
    date: new Date(start + i * 864e5).toISOString().slice(0, 10),
    contributionCount: Math.max(0, Math.round(3 * Math.sin(i / 5) + 2 + ((i * 7) % 4) - 2)),
  }));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push({ contributionDays: days.slice(i, i + 7) });
  const langs = (arr) => ({ edges: arr.map(([name, size]) => ({ size, node: { name } })) });
  return {
    followers: { totalCount: 3 },
    pullRequests: { totalCount: 4 },
    issues: { totalCount: 2 },
    repositories: {
      totalCount: 5,
      nodes: [
        { stargazerCount: 1, languages: langs([["C++", 90000], ["Lua", 8000]]) },
        { stargazerCount: 0, languages: langs([["C#", 40000]]) },
        { stargazerCount: 0, languages: langs([["JavaScript", 12000], ["CSS", 2000]]) },
      ],
    },
    contributionsCollection: {
      totalCommitContributions: 212,
      restrictedContributionsCount: 0,
      contributionCalendar: { totalContributions: 260, weeks },
    },
  };
}

const user = await fetchData();
await mkdir(OUT, { recursive: true });
await writeFile(new URL("stats.svg", OUT), statsCard(user));
await writeFile(new URL("top-langs.svg", OUT), langsCard(user));
await writeFile(new URL("activity.svg", OUT), activityCard(user));
console.log("cards written to assets/");
