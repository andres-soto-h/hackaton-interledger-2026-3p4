// Bundles the Lambda handler into a single `dist/lambda.js` (handler
// `lambda.handler`), which the infrastructure stack deploys as-is.
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const outdir = new URL('./dist/', import.meta.url)

await rm(outdir, { recursive: true, force: true })

await build({
  entryPoints: ['src/lambda.ts'],
  outfile: 'dist/lambda.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  // CommonJS so Lambda loads `lambda.js` without a package.json next to it.
  format: 'cjs',
  logLevel: 'info'
})
