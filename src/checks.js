import which from 'which';
import { execa } from 'execa';
import { log } from './logger.js';

async function checkBinary(name, installHint) {
  try {
    await which(name);
    return true;
  } catch {
    log.error(`${name} is not installed. ${installHint}`);
    return false;
  }
}

async function checkDockerRunning() {
  try {
    await execa('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    log.error('Docker daemon is not running. Start it before continuing.');
    return false;
  }
}

export async function runPreflight() {
  log.step('Checking dependencies...');

  const results = await Promise.all([
    checkBinary('git', 'Install it from https://git-scm.com/downloads'),
    checkBinary('node', 'Install it from https://nodejs.org'),
    checkBinary('npm', 'Install it from https://nodejs.org'),
    checkBinary('docker', 'Install it from https://docs.docker.com/get-docker/'),
  ]);

  if (!results.every(Boolean)) return false;

  const dockerRunning = await checkDockerRunning();
  if (!dockerRunning) return false;

  log.success('All dependencies found.');
  return true;
}

export async function runCloudPreflight() {
  log.step('Checking cloud dependencies...');

  const awsOk = await checkBinary('aws', 'Install it from https://aws.amazon.com/cli/');
  if (!awsOk) return null;

  // Validate credentials and fetch account info in one call
  let identity;
  try {
    const result = await execa('aws', ['sts', 'get-caller-identity', '--output', 'json']);
    identity = JSON.parse(result.stdout);
  } catch {
    log.error('AWS credentials are not configured or are invalid. Run: aws configure');
    return null;
  }

  // Docker must be running — CDK builds Docker images during deploy
  const dockerRunning = await checkDockerRunning();
  if (!dockerRunning) return null;

  log.success(`AWS credentials valid. Account: ${identity.Account}`);
  return { accountId: identity.Account };
}
