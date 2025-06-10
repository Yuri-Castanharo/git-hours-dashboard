// generate-report.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const { graphql } = require('@octokit/graphql');

// Config from .env
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const ORG = process.env.GITHUB_ORG;
const PROJECT_NUMBER = parseInt(process.env.GITHUB_PROJECT_NUMBER || '', 10);
const TOKEN = process.env.GITHUB_TOKEN;

if (!OWNER || !REPO || !ORG || isNaN(PROJECT_NUMBER) || !TOKEN) {
  console.error('Missing required env vars: GITHUB_OWNER, GITHUB_REPO, GITHUB_ORG, GITHUB_PROJECT_NUMBER, GITHUB_TOKEN');
  process.exit(1);
}

const octokit = new Octokit({ auth: TOKEN });
const graphqlWithAuth = graphql.defaults({ headers: { authorization: `token ${TOKEN}` } });

function hoursBetween(start, end) {
  return (new Date(end) - new Date(start)) / (1000 * 60 * 60);
}

// 1) Fetch all ProjectsV2 in the repository
async function fetchRepoProjects(owner, repo) {
  const query = `
    query($owner:String!, $repo:String!, $after:String) {
      repository(owner:$owner, name:$repo) {
        projectsV2(first:100, after:$after) {
          nodes { id title }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  let projects = [];
  let hasNext = true;
  let cursor = null;

  while (hasNext) {
    const res = await graphqlWithAuth(query, { owner, repo, after: cursor });
    const { nodes, pageInfo } = res.repository.projectsV2;
    projects.push(...nodes);
    hasNext = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return projects; // [{id,title}, ...]
}

// 2) Fetch items for a ProjectV2 and return PullRequest contents
async function fetchProjectPRItems(projectId) {
  const query = `
    query($projectId:ID!, $after:String) {
      node(id:$projectId) {
        ... on ProjectV2 {
          items(first:100, after:$after) {
            nodes { content { __typename ... on PullRequest { number createdAt mergedAt closedAt author { login } } } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;
  let items = [];
  let hasNext = true;
  let cursor = null;

  while (hasNext) {
    const res = await graphqlWithAuth(query, { projectId, after: cursor });
    const conn = res.node.items;
    items.push(...conn.nodes);
    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }

  return items
    .filter(i => i.content && i.content.__typename === 'PullRequest')
    .map(i => i.content);
}

(async () => {
  try {
    console.log(`Fetching Projects in ${OWNER}/${REPO}...`);
    const projects = await fetchRepoProjects(OWNER, REPO);

    const projectSummaries = [];
    for (const { id, title } of projects) {
      console.log(`Processing project: ${title}`);
      const prs = await fetchProjectPRItems(id);

      const userMap = {};
      prs.forEach(pr => {
        const end = pr.mergedAt || pr.closedAt;
        if (!end) return;
        const hrs = hoursBetween(pr.createdAt, end);
        if (hrs < 0) return;
        const user = pr.author.login;
        userMap[user] = (userMap[user] || 0) + hrs;
      });

      const total = Object.values(userMap).reduce((sum, v) => sum + v, 0);
      projectSummaries.push({
        project: title,
        total: Number(total.toFixed(2)),
        users: Object.fromEntries(
          Object.entries(userMap).map(([u, h]) => [u, Number(h.toFixed(2))])
        )
      });
    }

    console.log(`Fetching Org-level Project #${PROJECT_NUMBER} for Issues...`);
    // reuse fetchOrgProject and fetchProjectIssues from before
    const orgProject = await (async (org, num) => {
      const q = `
        query($org:String!, $num:Int!) {
          organization(login:$org) { projectV2(number:$num) { id title } }
        }
      `;
      const res = await graphqlWithAuth(q, { org, num });
      return res.organization.projectV2;
    })(ORG, PROJECT_NUMBER);

    const issues = await (async projectId => {
      const q = `
        query($projectId:ID!, $after:String) {
          node(id:$projectId) {
            ... on ProjectV2 { items(first:100, after:$after) {
              nodes { content { __typename ... on Issue { number title createdAt closedAt } } }
              pageInfo { hasNextPage endCursor }
            }}
          }
        }
      `;
      let all = [], hasNext = true, cursor = null;
      while (hasNext) {
        const r = await graphqlWithAuth(q, { projectId, after: cursor });
        const conn = r.node.items;
        all.push(...conn.nodes);
        hasNext = conn.pageInfo.hasNextPage;
        cursor = conn.pageInfo.endCursor;
      }
      return all.filter(i => i.content && i.content.__typename === 'Issue').map(i => i.content);
    })(orgProject.id);

    const issueTimeline = issues.map(issue => ({
      id: `${orgProject.title}_#${issue.number}`,
      name: issue.title,
      start: issue.createdAt,
      end: issue.closedAt || issue.createdAt
    }));

    const report = { projectSummaries, issueTimeline };
    const out = path.join(__dirname, 'public', 'report.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`report.json generated at ${out}`);
  } catch (err) {
    console.error('Error generating report:', err);
    process.exit(1);
  }
})();
