// Bundles the Lambda handler into a single `dist/lambda.js` (handler
// `lambda.handler`), which the infrastructure stack deploys as-is. It also
// copies the Open Payments OpenAPI specs (`.yaml`) the SDK reads at runtime,
// so they land next to the bundle at `/var/task/specs/`.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'

const outdir = new URL('./dist/', import.meta.url)
const specsSrc = new URL(
  './node_modules/@interledger/open-payments/dist/openapi/specs/',
  import.meta.url
)

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

// The SDK resolves these via `path.resolve(__dirname, './specs/*.yaml')`, so
// they must sit in `dist/specs/` (which becomes `/var/task/specs/` in Lambda).
const specsOut = new URL('./specs/', outdir)
await mkdir(specsOut, { recursive: true })
for (const file of await readdir(specsSrc)) {
  await copyFile(new URL(file, specsSrc), new URL(file, specsOut))
}
