#!/usr/bin/env bun

import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .scriptName('lean-libs')
  .usage('$0 <package>', 'Bundle an npm package into UMD and d.ts files')
  .positional('package', {
    describe: 'The npm package name to bundle (e.g., colord)',
    type: 'string',
  })
  .option('js-out', {
    alias: 'j',
    describe: 'Output directory for the UMD JS bundle',
    type: 'string',
    default: 'public/libs',
  })
  .option('dts-out', {
    alias: 'd',
    describe: 'Output directory for the bundled .d.ts types',
    type: 'string',
    default: 'src/types',
  })
  .option('global-name', {
    alias: 'g',
    describe: 'Global window variable name for UMD (defaults to package name)',
    type: 'string',
  })
  .demandCommand(1, 'You must specify a package to bundle')
  .help()
  .argv;

const pkgName = argv.package;
const globalName = argv['global-name'] || pkgName;
const jsOutDir = path.resolve(process.cwd(), argv['js-out']);
const dtsOutDir = path.resolve(process.cwd(), argv['dts-out']);

// Create a unique temporary directory
const tempDir = mkdtempSync(path.join(tmpdir(), 'lean-libs-'));

try {
  console.log(`📦 Preparing temp directory at ${tempDir}...`);

  // 1. Initialize temporary package and install requested library
  Bun.spawnSync(['bun', 'init', '-y'], { cwd: tempDir });
  console.log(`⬇️  Installing ${pkgName}...`);
  const installRes = Bun.spawnSync(['bun', 'add', pkgName, 'esbuild', 'dts-bundle-generator'], { cwd: tempDir });

  if (installRes.exitCode !== 0) {
    throw new Error(`Failed to install package: ${installRes.stderr.toString()}`);
  }

  // 2. Resolve entry points
  const pkgJsonPath = path.join(tempDir, 'node_modules', pkgName, 'package.json');
  const pkgJson = await Bun.file(pkgJsonPath).json();
  const entryPoint = path.join(tempDir, 'node_modules', pkgName, pkgJson.module || pkgJson.main || 'index.js');

  mkdirSync(jsOutDir, { recursive: true });
  mkdirSync(dtsOutDir, { recursive: true });

  const jsOutputFile = path.join(jsOutDir, `${pkgName}.umd.min.js`);
  const dtsOutputFile = path.join(dtsOutDir, `${pkgName}.d.ts`);

  // 3. Bundle JS into UMD format using esbuild
  console.log(`⚡ Bundling UMD to ${jsOutputFile}...`);
  const esbuildRes = Bun.spawnSync([
    'npx', 'esbuild', entryPoint,
    '--bundle',
    '--minify',
    '--format=iife',
    `--global-name=${globalName}`,
    `--outfile=${jsOutputFile}`
  ], { cwd: tempDir });

  if (esbuildRes.exitCode !== 0) {
    throw new Error(`esbuild error: ${esbuildRes.stderr.toString()}`);
  }

  // 4. Bundle d.ts types using dts-bundle-generator
  console.log(`📝 Bundling type definitions to ${dtsOutputFile}...`);
  const dtsRes = Bun.spawnSync([
    'npx', 'dts-bundle-generator',
    '-o', dtsOutputFile,
    entryPoint,
    '--no-check',
    '--export-nameless'
  ], { cwd: tempDir });

  if (dtsRes.exitCode !== 0) {
    // Fallback: try resolving type entry from package.json types/typings field
    const typesEntry = pkgJson.types || pkgJson.typings;
    if (typesEntry) {
      const altEntryPoint = path.join(tempDir, 'node_modules', pkgName, typesEntry);
      Bun.spawnSync([
        'npx', 'dts-bundle-generator',
        '-o', dtsOutputFile,
        altEntryPoint,
        '--no-check'
      ], { cwd: tempDir });
    }
  }

  // 5. Append ambient global Window declaration to the d.ts file
  const dtsContent = await Bun.file(dtsOutputFile).text();
  const globalDeclaration = `
declare global {
  interface Window {
    ${globalName}: typeof ${globalName};
  }
}
`;
  await Bun.write(dtsOutputFile, dtsContent + globalDeclaration);

  console.log(`✅ Success! Outputs written to:\n - ${jsOutputFile}\n - ${dtsOutputFile}`);

} catch (err) {
  console.error(`❌ Error: ${err.message}`);
} finally {
  // Clean up temp folder
  rmSync(tempDir, { recursive: true, force: true });
}