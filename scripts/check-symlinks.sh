#!/usr/bin/env bash
# Verify the agent-instruction symlinks and the skills symlink point
# where they should.
set -euo pipefail

status=0
check() {
  local link="$1" target="$2"
  if [ ! -L "$link" ]; then
    echo "::error file=${link}::${link} must be a symlink to ${target}"
    status=1
  elif [ "$(readlink "$link")" != "$target" ]; then
    echo "::error file=${link}::${link} points at $(readlink "$link"), expected ${target}"
    status=1
  fi
}
check CLAUDE.md AGENTS.md
check GEMINI.md AGENTS.md
check .cursorrules AGENTS.md
check .windsurfrules AGENTS.md
check .aider.conf.md AGENTS.md
check .github/copilot-instructions.md ../AGENTS.md
check .claude/skills ../.agents/skills
exit "$status"
