import ora from 'ora';
import { execa } from 'execa';

export async function run(label, cmd, args, options = {}) {
  const spinner = ora(label).start();
  try {
    await execa(cmd, args, { stdio: 'pipe', ...options });
    spinner.succeed(label);
  } catch (err) {
    spinner.fail(label);
    console.error(err.stderr || err.message);
    throw err;
  }
}

export async function runStreamed(label, cmd, args, options = {}) {
  const spinner = ora(label).start();
  try {
    const proc = execa(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    proc.stdout.pipe(process.stdout);
    proc.stderr.pipe(process.stderr);
    await proc;
    spinner.succeed(label);
  } catch (err) {
    spinner.fail(label);
    throw err;
  }
}
