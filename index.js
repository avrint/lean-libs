#!/usr/bin/env bun

import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import { dts } from 'rollup-plugin-dts';

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
const globalName =
  (argv['global-name']) ||
  pkgName.replace(/[@\/\-]/g, '_').replace(/^_+/, '');
const jsOutDir = path.resolve(process.cwd(), argv['js-out']);
const dtsOutDir = path.resolve(process.cwd(), argv['dts-out']);

// Create a unique temporary directory
const tempDir = mkdtempSync(path.join(tmpdir(), 'lean-libs-'));

try {
  console.log(`📦 Preparing temp directory at ${tempDir}...`);

  // 1. Initialize temporary package and install the requested library
  Bun.spawnSync(['bun', 'init', '-y'], { cwd: tempDir });
  console.log(`⬇️  Installing ${pkgName}...`);
  const installRes = Bun.spawnSync(['bun', 'add', pkgName], { cwd: tempDir });

  if (installRes.exitCode !== 0) {
    throw new Error(`Failed to install package: ${installRes.stderr.toString()}`);
  }

  // 2. Resolve entry points from the package's package.json
  const pkgJsonPath = path.join(tempDir, 'node_modules', pkgName, 'package.json');
  const pkgJson = await Bun.file(pkgJsonPath).json();

  // Prefer modern "exports" → module → main
  let entryPoint;
  const exp = pkgJson.exports?.['.'];
  if (typeof exp === 'string') {
    entryPoint = path.join(tempDir, 'node_modules', pkgName, exp);
  } else if (exp?.import) {
    entryPoint = path.join(
      tempDir,
      'node_modules',
      pkgName,
      typeof exp.import === 'string' ? exp.import : exp.import.default || exp.import
    );
  } else if (pkgJson.module) {
    entryPoint = path.join(tempDir, 'node_modules', pkgName, pkgJson.module);
  } else {
    entryPoint = path.join(
      tempDir,
      'node_modules',
      pkgName,
      pkgJson.main || 'index.js'
    );
  }

  // Prefer types entry for d.ts
  let typesEntry = null;
  if (exp?.types) {
    typesEntry = path.join(tempDir, 'node_modules', pkgName, exp.types);
  } else if (pkgJson.types || pkgJson.typings) {
    typesEntry = path.join(
      tempDir,
      'node_modules',
      pkgName,
      pkgJson.types || pkgJson.typings
    );
  } else {
    // Fallback: try index.d.ts next to the main entry
    const candidate = entryPoint.replace(/\.(m?js|cjs)$/, '.d.ts');
    if (await Bun.file(candidate).exists()) {
      typesEntry = candidate;
    }
  }

  mkdirSync(jsOutDir, { recursive: true });
  mkdirSync(dtsOutDir, { recursive: true });

  const safeName = pkgName.replace('/', '-');
  const jsOutputFile = path.join(jsOutDir, `${safeName}.umd.min.js`);
  const dtsOutputFile = path.join(dtsOutDir, `${safeName}.d.ts`);

  // -------------------------------------------------------
  // 3. Programmatic UMD JS bundle with Rollup
  // -------------------------------------------------------
  console.log(`⚡ Bundling UMD with Rollup → ${jsOutputFile}...`);

  const jsBundle = await rollup({
    input: entryPoint,
    plugins: [
      resolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      terser(),
    ],
  });

  await jsBundle.write({
    file: jsOutputFile,
    format: 'umd',
    name: globalName,
    exports: 'auto',
    sourcemap: false,
  });

  await jsBundle.close();

  // Append the global-export helper AFTER minification
  // (footer is stripped by terser, so we do it manually)
  const extra = `
// Ensure the main export is also available directly on the global
if (typeof ${globalName} === 'object' && ${globalName} !== null) {
  if ('${globalName}' in ${globalName}) {
    window.${globalName} = ${globalName}['${globalName}'];
  }
}
`;
  await Bun.write(jsOutputFile, (await Bun.file(jsOutputFile).text()) + extra);
  // -------------------------------------------------------
  // 4. Programmatic type definition bundle with rollup-plugin-dts
  // -------------------------------------------------------
  if (typesEntry) {
    console.log(
      `📝 Bundling type definitions with rollup-plugin-dts → ${dtsOutputFile}...`
    );

    const dtsBundle = await rollup({
      input: typesEntry,
      plugins: [
        // Resolve relative .d.ts files that live next to the package
        resolve({
          extensions: ['.d.ts', '.ts', '.js'],
          preferBuiltins: false,
        }),
        dts({
          // Force full inlining of the package's own types
          respectExternal: true,          // ← critical: don't treat relative paths as external
        }),
      ],
      // Make sure relative imports inside the package are *not* marked external
      external: (id) => {
        // Keep real third-party packages external, but allow everything
        // that belongs to the target package (relative or absolute path)
        return !id.startsWith('.') && !id.startsWith('/') && !id.includes(pkgName);
      },
    });

    await dtsBundle.write({
      file: dtsOutputFile,
      format: 'es',
    });

    await dtsBundle.close();

    // 5. Append ambient global Window declaration
    const dtsContent = await Bun.file(dtsOutputFile).text();
    const typeAlias =
      globalName.charAt(0).toUpperCase() +
      globalName.slice(1).replace(/[^a-zA-Z0-9]/g, '');

    const globalDeclaration = `

type ${typeAlias}Type = typeof ${globalName};

declare global {
  interface Window {
    ${globalName}: ${typeAlias}Type;
  }
  var ${globalName}: ${typeAlias}Type;
}
`;

    await Bun.write(dtsOutputFile, dtsContent + globalDeclaration);
  } else {
    console.warn(
      `⚠️  No type definitions found for ${pkgName}. Skipping .d.ts generation.`
    );
  }

  console.log(
    `✅ Success! Outputs written to:\n - ${jsOutputFile}\n - ${dtsOutputFile}`
  );
} catch (err) {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
} finally {
  // Clean up temp folder
  rmSync(tempDir, { recursive: true, force: true });
}