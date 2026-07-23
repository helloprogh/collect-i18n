# Collect I18n v0.2.1

This patch makes the published Skill a strictly client-neutral Agent Skill.

- Removes the OpenAI-specific `agents/openai.yaml` metadata from the universal package.
- Makes packaging fail if Claude-, Codex-, or OpenAI-specific metadata is added under the Skill root.
- Keeps the same `SKILL.md`, bundled CLI, runtime modules, and workflow for every compatible Agent.
- Documents installation through cross-client or client-native Skill directories.

There are no changes to project scanning, browser collection, TriggerPlan execution, Excel export, or workbook import.
