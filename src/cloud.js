import path from 'path';
import fs from 'fs';
import os from 'os';
import inquirer from 'inquirer';
import { execa } from 'execa';
import { runCloudPreflight } from './checks.js';
import { cloneRepos } from './git.js';
import { run, runStreamed } from './runner.js';
import { log } from './logger.js';

const VICTORIAMETRICS_YML = 'grafana/provisioning/datasources/victoriametrics.yml';
const LOCAL_VMSELECT_URL = 'url: http://vmselect:8481/select/0/prometheus';
const CLOUD_VMSELECT_URL = 'url: http://vmselect.trickl.local:8481/select/0/prometheus';

function patchVictoriaMetricsYml(pipelineDir) {
  const filePath = path.join(pipelineDir, VICTORIAMETRICS_YML);
  let content = fs.readFileSync(filePath, 'utf8');

  // Swap active/commented URLs for cloud
  content = content
    .replace(LOCAL_VMSELECT_URL, '#' + LOCAL_VMSELECT_URL)
    .replace('#' + CLOUD_VMSELECT_URL, CLOUD_VMSELECT_URL);

  fs.writeFileSync(filePath, content);
  log.info('Patched victoriametrics.yml for cloud (vmselect.trickl.local)');
}

async function getRegion() {
  try {
    const result = await execa('aws', ['configure', 'get', 'region']);
    return result.stdout.trim();
  } catch {
    return process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || '';
  }
}

async function readCdkOutputs(outputsFile) {
  try {
    const raw = fs.readFileSync(outputsFile, 'utf8');
    const parsed = JSON.parse(raw);
    const stack = parsed['ApplicationStack'] ?? {};
    return {
      albDnsName: stack['AlbDnsName'],
      metricsApiKeySecretArn: stack['MetricsApiKeySecretArn'],
    };
  } catch {
    return {};
  }
}

async function fetchApiKey(secretArn) {
  try {
    const result = await execa('aws', [
      'secretsmanager', 'get-secret-value',
      '--secret-id', secretArn,
      '--query', 'SecretString',
      '--output', 'text',
    ]);
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export async function cloudSetup(resolvedParent) {
  const identity = await runCloudPreflight();
  if (!identity) process.exit(1);

  let region = await getRegion();

  log.step('Cloud configuration...');
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'openaiKey',
      message: 'OpenAI API key:',
      mask: '*',
      validate: (v) => v.trim().length > 0 || 'Required.',
    },
    {
      type: 'input',
      name: 'domainName',
      message: 'Domain name (e.g. grafana.yourdomain.com):',
      validate: (v) => v.trim().length > 0 || 'Required.',
    },
    {
      type: 'input',
      name: 'certificateArn',
      message: 'ACM Certificate ARN (must already exist in your AWS region):',
      validate: (v) => v.startsWith('arn:aws:acm:') || 'Must be a valid ACM ARN (arn:aws:acm:...)',
    },
    ...(!region ? [{
      type: 'input',
      name: 'region',
      message: 'AWS Region (could not detect from CLI config):',
      default: 'us-east-1',
    }] : []),
  ]);

  if (!region) region = answers.region;

  log.info(
    'Note: ACM certificate must be validated (DNS) before deployment. ' +
    'Allow up to 30 min for new certificates.'
  );

  if (!fs.existsSync(resolvedParent)) {
    fs.mkdirSync(resolvedParent, { recursive: true });
    log.info(`Created ${resolvedParent}`);
  }

  // Clone all repos
  log.step('Cloning repos...');
  await cloneRepos(resolvedParent);

  const pipelineDir = path.join(resolvedParent, 'local_host_pipeline');
  const grafanaDir = path.join(resolvedParent, 'grafana_custom_plugin');
  const infraDir = path.join(resolvedParent, 'infrastructure');

  // Patch victoriametrics.yml to cloud URL before CDK builds the Docker image
  patchVictoriaMetricsYml(pipelineDir);

  // Build grafana plugin — Grafana Dockerfile COPYs from plugin-dist/trickl-trickl-app
  log.step('Installing and building Grafana plugin...');
  await run('npm install — grafana_custom_plugin', 'npm', ['install'], { cwd: grafanaDir });

  fs.mkdirSync(
    path.join(pipelineDir, 'grafana', 'plugin-dist', 'trickl-trickl-app'),
    { recursive: true }
  );

  await run('npm run build — grafana_custom_plugin', 'npm', ['run', 'build'], { cwd: grafanaDir });

  // Install infrastructure dependencies (needed for npx cdk to use pinned version)
  log.step('Installing infrastructure dependencies...');
  await run('npm install — infrastructure', 'npm', ['install'], { cwd: infraDir });

  // Bootstrap CDK (idempotent — safe to always run)
  log.step('Bootstrapping CDK...');
  await runStreamed(
    `cdk bootstrap aws://${identity.accountId}/${region}`,
    'npx', ['cdk', 'bootstrap', `aws://${identity.accountId}/${region}`],
    { cwd: infraDir }
  );

  // Deploy
  const outputsFile = path.join(os.tmpdir(), 'trickl-cdk-outputs.json');
  log.step('Deploying to AWS (this takes ~10-15 minutes)...');
  await runStreamed(
    'cdk deploy --all',
    'npx',
    [
      'cdk', 'deploy', '--all',
      '--require-approval', 'never',
      '--outputs-file', outputsFile,
      '--parameters', `ApplicationStack:CertificateArn=${answers.certificateArn}`,
      '--parameters', `ApplicationStack:DomainName=${answers.domainName}`,
      '--parameters', `ApplicationStack:OpenAiApiKey=${answers.openaiKey}`,
    ],
    { cwd: infraDir }
  );

  // Read stack outputs
  const outputs = await readCdkOutputs(outputsFile);
  const apiKey = outputs.metricsApiKeySecretArn
    ? await fetchApiKey(outputs.metricsApiKeySecretArn)
    : null;

  log.success('Cloud deployment complete.\n');

  if (outputs.albDnsName) {
    console.log('  Next step — point your domain DNS to the load balancer:');
    console.log(`    CNAME  ${answers.domainName}  →  ${outputs.albDnsName}\n`);
  }

  console.log('  Send metrics to Vector:');
  console.log(`    https://${answers.domainName}:9090/v1/metrics`);
  console.log('    Header: X-API-Key: ' + (apiKey ?? '(retrieve from Secrets Manager)') + '\n');

  console.log('  Query data in Grafana:');
  console.log(`    https://${answers.domainName}  (Cognito login)\n`);

  console.log('  Final manual step — create your first Grafana user in Cognito:');
  console.log('    AWS Console → Cognito → User Pools → TricklUserPool → Create user\n');
}
