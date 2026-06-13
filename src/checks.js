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

  const allBinariesOk = results.every(Boolean);
  if (!allBinariesOk) return false;

  const dockerRunning = await checkDockerRunning();
  if (!dockerRunning) return false;

  log.success('All dependencies found.');
  return true;
}
