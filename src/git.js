import { run } from './runner.js';

const REPOS = [
  {
    name: 'local_host_pipeline',
    url: 'https://github.com/Trickl-app/local_host_pipeline',
    branch: 'main',
  },
  {
    name: 'grafana_custom_plugin',
    url: 'https://github.com/Trickl-app/grafana_custom_plugin',
    branch: 'main',
  },
  {
    name: 'infrastructure',
    url: 'https://github.com/Trickl-app/infrastructure',
    branch: 'main',
  },
];

export async function cloneRepos(parentDir) {
  for (const repo of REPOS) {
    await run(
      `Cloning ${repo.name} (${repo.branch})`,
      'git',
      ['clone', '--branch', repo.branch, repo.url, repo.name],
      { cwd: parentDir }
    );
  }
}

export { REPOS };
