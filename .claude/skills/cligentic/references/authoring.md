# Authoring a cligentic block

Use this branch only when contributing a reusable primitive to the cligentic registry.

## 1. Prove the primitive

Start from behavior exercised in a real CLI. Identify the repeated infrastructure, its failure modes, and the project-specific details that must be removed.

Choose the narrowest layer:

- `platform`: operating-system and environment boundaries.
- `foundation`: persistence, configuration, parsing, errors, and other shared infrastructure.
- `agent`: machine interaction, supervision, and agent-facing command behavior.
- `safety`: emergency controls that stop consequential operations.

**Done when:** the primitive has real provenance, one layer, and a generic contract with no product-specific names or secrets.

## 2. Add the source and registry contract

Create `registry/<layer>/<name>.ts`, then add one item to `registry.json` with its target path, package dependencies, and full registry dependency graph. Use existing blocks rather than copying their behavior into the new file.

Add `site/content/blocks/<name>.mdx` with the problem, installation command, integration example, contract, and provenance. Update the README catalog and production evidence when the new block changes either.

**Done when:** source, manifest, docs, and catalog describe one contract and every dependency is declared.

## 3. Build every distribution surface

Run:

```bash
bun run build
bun run --cwd site build
bun run test:e2e:package-registry
```

The site build synchronizes the checked-in site registry mirror and emits both JSON entries and raw TypeScript. Inspect the generated `<name>.json` and `<name>.ts`; the raw file must equal the generated file content.

**Done when:** root registry output, site output, package.json-only installation, transitive dependencies, and raw source projection all pass.

## 4. Prove the consumer experience

In an isolated Bun project with no `components.json`, register `@cligentic`, then search, view, and add the new block. Typecheck a minimal call site and exercise its defining behavior.

After deployment, verify the catalog, JSON endpoint, raw endpoint, and documentation page from production.

**Done when:** a fresh consumer installs the full closure without `components.json` and the live endpoints match the merged source.
