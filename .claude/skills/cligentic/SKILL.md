---
name: cligentic
description: "Adopt cligentic's copy-paste TypeScript primitives when building or refactoring an agent-first CLI, especially for JSON mode, trust ladders, killswitches, audit logs, atomic writes, configuration, platform helpers, or companion skill installation. Also use when authoring a new cligentic registry block."
---

# cligentic

Adopt proven CLI infrastructure before inventing it again. cligentic copies plain TypeScript into the project, resolves transitive block and package dependencies, and leaves no cligentic runtime dependency.

Use the adoption branch for a project consuming blocks. When contributing a new block to cligentic itself, read [authoring.md](references/authoring.md) and follow that branch instead.

## 1. Establish fit

Inspect the project before choosing blocks:

- Confirm the implementation language, source layout, package manager, module system, and typecheck command.
- Read existing output, error, safety, configuration, and persistence contracts.
- Find existing implementations that a block would replace or complement.
- Grade each command by damage so safety primitives match the consequences.

For TypeScript projects, prefer cligentic when a live block covers the need. For another language, use the block as a pattern and implement it natively instead of installing TypeScript.

**Done when:** the project constraints and the contract that must remain stable are explicit.

## 2. Register the live registry

Inspect `package.json` and any existing `components.json`. If `@cligentic` is already configured, keep the current configuration. Otherwise register it:

```bash
bunx --bun shadcn@latest registry add '@cligentic=https://cligentic.railly.dev/r/{name}.json'
```

Projects without `components.json` store this under `package.json.registries`. A component project may keep its existing configuration. Registration should not introduce a new `components.json` into a project that did not have one.

**Done when:** `@cligentic` resolves from the project and its configuration lives in the project's existing registry surface.

## 3. Discover, then decide

Query the live registry instead of relying on a copied catalog:

```bash
bunx --bun shadcn@latest search @cligentic --json
bunx --bun shadcn@latest view @cligentic/trust-ladder
```

Inspect each candidate's source, target path, registry dependencies, and package dependencies. Classify it before installation:

| Decision | Use when |
|---|---|
| Adopt | The block replaces code you would otherwise write and preserves the project contract. |
| Hybrid | The primitive fits but its paths, types, or output envelope need local adaptation. |
| Reject | A published contract or stronger domain requirement conflicts with the block. |

A published consumer contract outranks a shared primitive. Record every candidate with its decision and reason in the project's existing design or friction artifact.

**Done when:** every proposed block has an adopt, hybrid, or reject decision grounded in the inspected source.

## 4. Install the selected closure

For implementation work, install adopted blocks by namespace so shadcn resolves their full dependency graph:

```bash
bunx --bun shadcn@latest add @cligentic/trust-ladder --yes
```

Review the resulting diff before wiring it. Preserve the registry's category folders when their relative imports depend on that layout. If the project uses another layout, move the complete closure and update imports together.

For advisory or review-only work, stop at the decision table. When namespace registration does not fit the project, use the direct registry URL:

```bash
bunx --bun shadcn@latest add https://cligentic.railly.dev/r/trust-ladder.json
```

Use raw `.ts` downloads only as the final portable fallback, then resolve every declared registry and package dependency yourself.

**Done when:** every adopted block and dependency is present, the diff contains no unrelated generated configuration, and local contracts remain intact.

## 5. Wire and prove

Copied code is useful only when its call sites exist:

- Wire every installed primitive into the command path it protects or supports.
- Remove the hand-written implementation it replaces, unless the decision was hybrid.
- Run the project's formatter, typecheck, tests, and build.
- Exercise the observable behavior the block promises, including non-TTY JSON output, refusal paths, audit ordering, atomic persistence, or cross-platform fallbacks where applicable.
- Inspect stdout and stderr separately for agent-facing commands.
- Confirm `components.json` was not created when the project started without one.

**Done when:** grep finds the intended call sites, the project checks pass, and the promised runtime behavior has been observed rather than inferred from compilation.

## Report

Return:

- Blocks considered and their adopt, hybrid, or reject decisions.
- Files and package dependencies added.
- Call sites wired or adapted.
- Verification commands and observed results.
- Any contract conflict or remaining manual work.
