import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REQUIRED_PEPPOL_SCHEMATRON_FILES } from '../../src/schematron/index.js'

/**
 * The container image is how hosted deploys get Schematron artefacts: they are
 * not in git (OpenPeppol redistribution terms). A Dockerfile that forgets the
 * fetch or the COPY ships a tree that looks like reference-data/peppol/bis-3
 * but validates nothing — the failure mode this PR exists to close.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const DOCKERFILE = join(ROOT, 'Dockerfile')
const FETCH_SCRIPT = join(ROOT, 'tools', 'fetch-peppol-bis3.sh')

describe('the image build ships Peppol Schematron', () => {
  it('fetches the pinned artefacts and copies reference-data into the runtime', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8')

    expect(dockerfile).toMatch(/apk add --no-cache bash curl/)
    expect(dockerfile).toMatch(/pnpm run peppol:fetch/)
    expect(dockerfile).toMatch(/COPY --from=build \/app\/reference-data \.\/reference-data/)
    expect(dockerfile).toMatch(/ENV KLOPT_REFERENCE_DATA_DIR=\/app\/reference-data/)
  })

  it('pins SHA-256 checksums for both required artefacts', () => {
    const script = readFileSync(FETCH_SCRIPT, 'utf8')

    expect(script).toMatch(/CEN_SHA256=[0-9a-f]{64}/)
    expect(script).toMatch(/PEPPOL_SHA256=[0-9a-f]{64}/)
    for (const name of REQUIRED_PEPPOL_SCHEMATRON_FILES) {
      expect(script).toContain(name)
    }
  })
})
