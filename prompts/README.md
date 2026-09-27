# `prompts/`

Versioned LLM prompts. See [`OSS_SPEC.md` §13.5](../OSS_SPEC.md#135-llm-prompts-prompts).

**storage makes no LLM calls**: the server, the testkit and the reference
app never send data to a language model — for a zero-knowledge backend
holding health data that is a design constraint, not an omission. This
directory therefore holds no prompts.

If a future tool in this repository ever calls a model, every prompt must
live here as a versioned file rather than an inline string:

```
prompts/
└── <prompt-name>/
    ├── 1_0_0.md
    └── 1_1_0.md   # every change is a new file at a bumped semver
```

Each file starts with YAML front matter (`name`, `description`, and a
`version` matching the filename stem) and has `## System` and `## User`
sections. Committed versions are never edited.
