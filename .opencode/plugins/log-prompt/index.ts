import { Plugin } from "@opencode/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

/**
 * OpenCode equivalent of the Claude Code `UserPromptSubmit` hook
 * (`.claude/hooks/log-prompt.sh`).
 *
 * Appends each user prompt to `AI/prompts/<git-user>.md` so every team member
 * has their own log and merges don't conflict.
 */

function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "unknown"
}

function localTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

export default Plugin.define({
  id: "log-prompt",
  async setup(ctx) {
    const projectDir = ctx.location.directory

    const logPrompt = (text: string) => {
      const prompt = text.trim()
      if (!prompt) return
      // Parity with the Claude hook: skip automated background-task notifications.
      if (/^\s*<task-notification>/.test(prompt)) return

      let slug = "unknown"
      try {
        slug = slugify(
          execSync("git config user.name", { cwd: projectDir, encoding: "utf8" }).trim(),
        )
      } catch {
        // keep "unknown"
      }

      const promptsDir = join(projectDir, "AI", "prompts")
      mkdirSync(promptsDir, { recursive: true })
      appendFileSync(
        join(promptsDir, `${slug}.md`),
        `\n### ${localTimestamp()}\n\n${prompt}\n`,
      )
    }

    await ctx.session.hook("prompt", (event) => {
      logPrompt(event.prompt.text)
    })

    return () => {}
  },
})
