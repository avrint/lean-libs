# lean-libs

`lean-libs` makes npm libraries easy to use in static and zero-dependency projects.

It takes a library you want to use, produces a browser-ready bundle and TypeScript definitions, and places them directly into your project.

Useful for **Astro, static sites, Web Components, and projects that don't use a runtime package dependency.**

## Installation

```bash
bun install -g git+https://github.com/avrint/lean-libs.git
```

## Usage

Run `lean-libs` from your project:

Example
```bash
lean-libs npm-pacakge
```

This gives you:

* A browser-ready JavaScript bundle `npm-pacakge.umd.min.js`
* TypeScript definitions for editor autocomplete `npm-pacakge.d.ts`
* No library added to your project's runtime dependencies

## Options

```bash
lean-libs <package> [options]
```

| Option          | Alias | Default       |
| --------------- | ----- | ------------- |
| `--js-out`      | `-j`  | `public/libs` |
| `--dts-out`     | `-d`  | `src/types`   |
| `--global-name` | `-g`  | Package name  |

### Examples

Custom output locations:

```bash
lean-libs npm-pacakge -j static/vendor -d src/typings
```

Custom browser global:

```bash
lean-libs lodash-es -g _
```

## Why lean-libs?

Use npm libraries **without turning your project into an npm application**.

Keep the source project lean while still benefiting from the ecosystem of existing libraries.
