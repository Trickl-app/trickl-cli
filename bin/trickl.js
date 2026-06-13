#!/usr/bin/env node
import { setup } from '../src/setup.js';

setup().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
