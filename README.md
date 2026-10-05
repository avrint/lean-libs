# lean-libs

`lean-libs` installs an npm library into a temporary folder, bundles it using `esbuild` and `dts-bundle-generator`, outputs static files into your project, and cleans up after itself. Perfect for Astro, static sites, or zero-dependency setups.

## Installation

```bash
bun install -g git+https://github.com/avrint/lean-libs.git

```

## Quick Start

Run the command inside your target project directory:

```bash
# Bundles 'colord' -> public/libs/colord.umd.min.js & src/types/colord.d.ts
lean-libs colord

```

## CLI Usage & Options

```bash
lean-libs <package> [options]

```

| Option | Alias | Default | Description |
| --- | --- | --- | --- |
| `--js-out` | `-j` | `public/libs` | Output directory for the `.umd.min.js` bundle |
| `--dts-out` | `-d` | `src/types` | Output directory for the `.d.ts` file |
| `--global-name` | `-g` | `<package>` | Window variable name assigned to the UMD bundle |

### Examples

**Custom Output Paths:**

```bash
lean-libs colord -j static/vendor -d src/typings

```

**Custom Global Variable Name:**

```bash
lean-libs lodash-es -g _

```

## Project Usage (Astro)

1. Load the generated script static asset:

```html
<script is:inline src="/libs/colord.umd.min.js"></script>

```

2. Write client-side code with full auto-complete:

```typescript
<script>
  // Global type resolves from src/types/colord.d.ts automatically
  const hex = colord("#00ff00").toHex();
</script>

```
