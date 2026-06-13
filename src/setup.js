import path from 'path';
import os from 'os';
import fs from 'fs';
import inquirer from 'inquirer';
import { runPreflight } from './checks.js';
import { cloneRepos } from './git.js';
import { run, runStreamed } from './runner.js';
import { log } from './logger.js';

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export async function setup() {
  const ok = await runPreflight();
  if (!ok) process.exit(1);

  log.step('Where should the repos be cloned?');
  const { parentDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'parentDir',
      message: 'Parent directory:',
      default: '~/projects',
      validate: (input) => input.trim().length > 0 || 'Please enter a directory path.',
    },
  ]);

  const resolvedParent = path.resolve(expandHome(parentDir.trim()));

  const { deploymentType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'deploymentType',
      message: 'Deployment type:',
      choices: [
        { name: 'Local (Docker)', value: 'local' },
        { name: 'Cloud', value: 'cloud' },
      ],
    },
  ]);

  if (deploymentType === 'cloud') {
    log.info('Cloud deployment coming soon.');
    process.exit(0);
  }

  log.info('Proceeding with local Docker deployment.');

  if (!fs.existsSync(resolvedParent)) {
    fs.mkdirSync(resolvedParent, { recursive: true });
    log.info(`Created ${resolvedParent}`);
  }

  // Clone
  log.step('Cloning repos...');
  await cloneRepos(resolvedParent);

  // Initialise required vmagent config files that are not tracked in the repo
  const vmagentDir = path.join(resolvedParent, 'local_host_pipeline', 'vmagent');
  fs.writeFileSync(path.join(vmagentDir, 'aggregations.yml'), '[]\n');
  fs.writeFileSync(path.join(vmagentDir, 'relabel.yml'), '[]\n');
  log.info('Created vmagent/aggregations.yml and relabel.yml');

  // npm install for pipeline and grafana plugin only
  log.step('Installing dependencies...');
  for (const name of ['local_host_pipeline', 'grafana_custom_plugin']) {
    await run(`npm install — ${name}`, 'npm', ['install'], {
      cwd: path.join(resolvedParent, name),
    });
  }

  // Ensure the cp destination exists before the build script runs
  fs.mkdirSync(
    path.join(resolvedParent, 'local_host_pipeline', 'grafana', 'plugin-dist', 'trickl-trickl-app'),
    { recursive: true }
  );

  // Build grafana plugin — build script copies dist to ../local_host_pipeline/grafana/plugin-dist/trickl-trickl-app
  log.step('Building Grafana plugin...');
  await run('npm run build — grafana_custom_plugin', 'npm', ['run', 'build'], {
    cwd: path.join(resolvedParent, 'grafana_custom_plugin'),
  });

  // Start local pipeline
  log.step('Starting local_host_pipeline...');
  await runStreamed(
    'docker compose up --build -d',
    'docker',
    ['compose', 'up', '--build', '-d'],
    { cwd: path.join(resolvedParent, 'local_host_pipeline') }
  );

  log.success('Setup complete. Local pipeline is running.\n');
  console.log('  Send metrics to Vector:');
  console.log('    HTTP (OTLP)  →  http://localhost:9090');
  console.log('    gRPC (OTLP)  →  localhost:4317');
  console.log('');
  console.log('  Query data in Grafana:');
  console.log('    http://localhost:3000  (admin / admin)');
  console.log('');
}
