#!/usr/bin/env bash
# UserPromptSubmit hook: appends each prompt to AI/prompts/<git-user>.md
# so every team member has their own log and merges don't conflict.

name=$(git -C "$CLAUDE_PROJECT_DIR" config user.name 2>/dev/null)
slug=$(printf '%s' "$name" \
  | perl -CS -MUnicode::Normalize -pe '$_ = NFD($_); s/\p{Mn}//g; $_ = lc; s/[^a-z0-9]+/-/g; s/^-+|-+$//g')
[ -z "$slug" ] && slug="unknown"

input=$(cat)
# Skip automatic background-task notifications; only log what the user typed.
printf '%s' "$input" | jq -e '.prompt | test("^\\s*<task-notification>")' >/dev/null 2>&1 && exit 0

dir="$CLAUDE_PROJECT_DIR/AI/prompts"
mkdir -p "$dir"
printf '%s' "$input" | jq -r '"\n### " + (now|localtime|strftime("%Y-%m-%d %H:%M:%S")) + "\n\n" + .prompt + "\n"' >> "$dir/$slug.md"
