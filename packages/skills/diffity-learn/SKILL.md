---
name: diffity-learn
description: Learn a programming concept by exploring real examples in the current codebase. Builds a teaching tour that progressively explains the concept from simple to complex.
user-invocable: true
---

# Diffity Learn Skill

You are creating a **teaching tour** — a narrated, step-by-step walkthrough that teaches a programming concept using real examples found in the current codebase. Unlike a regular code tour that explains "how does feature X work", this tour teaches a **concept** (e.g. closures, generics, error handling patterns) by finding real instances in the code and explaining them progressively.

## Arguments

- `concept` (required): The programming concept to teach. Examples:
  - `/diffity-learn closures in JavaScript`
  - `/diffity-learn async/await`
  - `/diffity-learn dependency injection`
  - `/diffity-learn React hooks`
  - `/diffity-learn error handling patterns`
  - `/diffity-learn generics in TypeScript`

## CLI Reference

```
{{binary}} agent tour-start --topic "<text>" [--body "<text>"] --json
{{binary}} agent tour-step --tour <id> --file <path> --line <n> [--end-line <n>] --body "<text>" [--annotation "<text>"] --json
{{binary}} agent tour-done --tour <id> --json
{{binary}} list --json
```

## Prerequisites

1. Check that `{{binary}}` is available: run `which {{binary}}`. If not found, {{install_hint}}.
2. Ensure a tree instance is running: run `{{binary}} list --json`.
   - If no instance is running, start one: run `{{binary}} tree --no-open` using the Bash tool with `run_in_background: true`, wait 2 seconds, then run `{{binary}} list --json` to get the port.

## Instructions

### Phase 1: Find examples in the codebase

This is the most important phase. You must find **real, concrete examples** of the concept in this codebase.

1. **Identify what to search for.** Based on the concept, determine what code patterns to look for:
   - For "closures": functions returned from other functions, callbacks capturing outer variables, factory patterns
   - For "async/await": async functions, Promise chains, error handling with try/catch in async contexts
   - For "generics": generic type parameters, generic functions/classes, constrained generics
   - For "React hooks": useState, useEffect, useCallback, useMemo, custom hooks
   - Think broadly about what forms the concept takes in practice

2. **Search the codebase.** Use grep, glob, and file reads to find instances. Search for:
   - Language keywords associated with the concept
   - Common patterns and idioms
   - Both simple and complex usage

3. **Select and rank examples.** Pick 3-8 examples that:
   - Are **real and meaningful** — not trivial boilerplate
   - Cover **different facets** of the concept — not 5 examples of the same thing
   - Progress from **simple to complex** — the first example should be the easiest to understand
   - Are **self-contained enough** to explain without extensive context

4. **Understand each example deeply.** Read the surrounding code. Know why the concept is used here, what alternatives existed, and what would break without it.

### Phase 2: Create the teaching tour

The tour should feel like a patient teacher walking a beginner through real code, building their understanding step by step.

1. **Start the tour** with a concept introduction:
   ```
   {{binary}} agent tour-start --topic "<Concept Name>" --body "<concept overview>" --json
   ```

   The `--topic` should be the concept name — keep it to **2-5 words** (e.g. "JavaScript Closures", "Async/Await Patterns", "TypeScript Generics").

   **Writing the intro body (step 0):**
   This is a standalone explanation of the concept that the reader sees before any code. Write it for someone who has basic programming knowledge but hasn't encountered this concept (or has only a vague understanding). Include:
   - **What** the concept is — a clear, jargon-free definition
   - **Why** it exists — what problem does it solve? What would code look like without it?
   - **Mental model** — an analogy or way of thinking about it that makes it click
   - **What to look for** — the syntactic or structural clues that tell you "this is an example of X"
   - A preview of what the reader will see: "In this codebase, we'll look at N examples ranging from simple to complex"

   Use rich markdown formatting. Do NOT list the files you'll visit — this is a concept explanation, not a table of contents.

   Extract the tour ID from the JSON output.

2. **Add steps** in order of increasing complexity. For each step:
   ```
   {{binary}} agent tour-step --tour <id> --file <path> --line <start> --end-line <end> --body "<narrative>" --annotation "<short label>" --json
   ```

   **Writing teaching steps:**

   Each step should teach **one facet** of the concept through a concrete example. The narrative has two jobs: explain the concept AND explain why it's used in this specific code.

   Structure each step's body as:

   - **What you're looking at** — orient the reader in the code. What does this file/function do? (1-2 sentences)
   - **The concept in action** — point out where and how the concept appears. Be specific: "On line 15, `config` is captured by the inner function — this is a closure because..."
   - **Why it's used here** — what problem does this solve in this specific context? What would the code look like without this pattern?
   - **Key takeaway** — one sentence summarizing what this example teaches about the concept

   **Progression guidelines:**
   - **First example**: The simplest, most isolated instance. Minimal surrounding complexity. The reader should think "oh, that's all it is?"
   - **Middle examples**: Introduce variations, edge cases, or more sophisticated usage. Each example should add one new dimension.
   - **Last example**: The most complex or elegant usage. By now the reader has enough context to appreciate it.

   **IMPORTANT — Goto links for code references:**
   Every time you mention a function, class, variable, or type that exists in a known file, you MUST make it a goto link. Do NOT use plain backtick code for symbols you can locate. The reader should be able to click any code reference to jump to its definition.

   Syntax: `` [`symbolName`](goto:path/to/file.ts:startLine-endLine) `` or `` [`symbolName`](goto:path/to/file.ts:line) `` for a single line.
   Example: `` [`handleDragEnd`](goto:src/KanbanContent.jsx:42-58) ``

   These render as clickable inline code that navigates to the file and highlights the target lines. Use plain backtick code ONLY for generic terms, CLI commands, language keywords, or symbols you haven't located in the codebase.

   **Do:**
   - Use **bold** for concept terms being introduced or reinforced
   - Use [sub-highlights](focus:startLine-endLine) when a step covers 30+ lines to guide the reader's eye
   - Draw connections between examples: "Unlike the previous example where X, here we see Y"
   - Include "what if" scenarios: "If we removed the `async` keyword here, this would return a raw Promise instead of..."
   - Use mermaid diagrams sparingly — only when visualizing flow or state helps (e.g., a Promise chain, a closure's scope chain)

   **Don't:**
   - Assume knowledge of the concept — you're teaching it
   - Just describe the syntax — explain the *why*
   - Use jargon without defining it first
   - Skip explaining why this specific code uses the pattern
   - Show the same facet of the concept repeatedly

3. **Finish the tour:**
   ```
   {{binary}} agent tour-done --tour <id> --json
   ```

### Phase 3: Open in browser

1. Get the running instance port from `{{binary}} list --json`.
2. Open the tour: `open "http://localhost:<port>/tour/<tour-id>"` (or the appropriate command for the user's OS).
3. Tell the user the tour is ready:

   > Your learning tour is ready — check your browser.

## Quality Checklist

Before finishing, verify:

- [ ] Intro (step 0) explains the concept clearly for someone who doesn't know it
- [ ] Examples progress from simple to complex
- [ ] Each step explains both the concept AND why it's used in this specific code
- [ ] No two steps teach the same facet — each adds something new
- [ ] At least 3 examples are included (unless the codebase genuinely has fewer)
- [ ] Every function, class, or symbol reference with a known file location uses a goto link — no plain backtick code for locatable symbols
