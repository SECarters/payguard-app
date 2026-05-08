# fwo-corpus-loader

## Purpose
Loads and validates the FWO knowledge corpus before every payroll audit. Returns a structured summary of all available facts, the file index, and any integrity warnings.

## When to use
Run this at the start of every audit session, or when answering any question about Australian payroll law, entitlements, or compliance obligations.

## What it does
1. Reads `_MASTER_INDEX.json` to confirm all 30 files are present
2. Validates MD5 checksums
3. Loads all `key_facts` into a single consolidated output
4. Returns the topic map so the correct files can be looked up quickly
5. Reports any missing files or integrity issues

## Arguments
Optional: `topics` — comma-separated list of topics to filter (e.g. "superannuation,overtime,casual")
If omitted, loads the full index summary.

## Output
- Corpus status (file count, last built, currency)
- Key facts for requested topics (or all)
- List of files to read for each topic
- Any warnings or gaps
