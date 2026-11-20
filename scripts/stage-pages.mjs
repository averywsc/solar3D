import { cp, rm } from 'node:fs/promises';

const build = new URL('../dist/', import.meta.url);
const published = new URL('../site/', import.meta.url);

await rm(published, { recursive: true, force: true });
await cp(build, published, { recursive: true });
