import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Merged migrations are immutable (product rule + migrate.ts checksum).
 *
 * Editing a file that has already run on hosted (or any instance) makes the
 * next deploy throw "Migration … changed after it was applied". Pin the
 * sha256 of every migration through 0034 so a drive-by edit fails CI.
 *
 * When 0035+ merges to main, extend MERGED_THROUGH and add its pin.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Highest migration number that has landed on main and must not change. */
const MERGED_THROUGH = 34

/**
 * sha256 of each file's full UTF-8 text — same algorithm as
 * `packages/db/src/migrate.ts`.
 */
const PINNED_CHECKSUMS: Readonly<Record<string, string>> = {
  '0000_schema.sql': '4084bcc42fb65a1f0ac23f1027be224c2a1886d9af2c46bd822e7c0dbd19234e',
  '0001_ledger_guards.sql': 'bfb60d728d740f169ea795e5c5aa170ce1f7e77bdbfcec6b439975ba0ccc2dac',
  '0002_sales.sql': '235419e03c78bd10bec1eeb3a09e3cf92ee2b80a23e145b1e415c4558f32874d',
  '0003_entity_invitations.sql': 'f45e461f2887f5c2790d19acda81d27088d1823ca60cb84b94b9c0941dfba32a',
  '0004_billing_details.sql': '582457c0e51be2c507cf8ffc9f1fee37c27b0fe9f809c8ebf89a33c65e109a93',
  '0005_dunning.sql': '0f088a7cf7d70495f3aee04e27fdfb1e04af132b8fc972aaa2ff8a99365c4fd2',
  '0006_banking.sql': '391c3a1ab20180859cb56e6f39fed1509b65650e042c5a9dcb7890be3d00d961',
  '0007_bank_matching.sql': '9b5a2d7a0e4c3d0d6b0ed668fbd85f23ca368a12ec92c98848f54e880758f1ce',
  '0008_rule_conditions_nulls.sql': 'c1213ca9a39abe87b24809d1a458630f4e71437ff699bb4f23c13d41575d7901',
  '0009_csv_mapping.sql': '1e7f56aad6d0c0cecdf0ff8c4fffd89be273f0a3d0d71e44e6bae61a877ab45b',
  '0010_payments.sql': 'e4028812aa31440e431a8ddb262ad6069763517e07cef3eeea60c018f86e15b0',
  '0011_payment_actors.sql': 'e06e233d25140eadbba28bb02a122b8d3e1917f84fae5115be453cd98385ba68',
  '0012_vat_engine.sql': '550c2374d1f27cb07b97cde23b466bf857b15b9398716c3a4913556ea88d0434',
  '0013_icp.sql': 'c44ea3e9a247a70688000456797c1ce46461d5dfaf5bcd09141ff64bf2310c74',
  '0014_ubl_category_is_text.sql': '24ba2c8572d0b8094cab99a13e3c841f1bc2a725941760ffb4fbd98e6f5aa317',
  '0015_filing_submissions.sql': '79cec0ac08c76bd5389f1e07df525d642e6268a5ab72cdb2f4af727a5dd7a005',
  '0016_purchase.sql': '2ba1e114d003a49940ec9e77306e5619fbb8fb2ce4ebf5df789d3c909c95b8a8',
  '0017_documents_and_inbox.sql': 'cbffd41e2504540d5e3aece2eb004d3b75b506d5d962666663e0f72492c7e9ff',
  '0018_inbound_sources.sql': '392eec8f097f53f0b17bf31c6ed97cc1ec97b8eef74ff381f3014a9f4db1ef30',
  '0019_bank_charges_account.sql': 'd8cd192ad6ea2a75659668ed4f99f114e6a89b6eb855d95fa92fd44440b77c6b',
  '0020_retention.sql': '6307991b90351f4eba0c471283c12c53e3d12db3aef92316c367462de8359262',
  '0021_sealed_snapshots.sql': 'e9cc0f777f8f2bb929c76039679de548b6f99539de65b5838b25db75934f73df',
  '0022_exact_connections.sql': 'e7b42d684b82d2f76e6e3828fb7de7aea511f21a250b326f7ebfa19c7b9940c4',
  '0023_oauth.sql': '29e8c9fd2025da1b73b2ca49e41998344f87e66a3e4b67d22ea80063a31ce008',
  '0024_exact_documents.sql': 'cc8e432adca2534538d8c40d2d53c71fe4480e198a8bd4892c5c62a8000529fa',
  '0025_inbound_backoff.sql': 'eb788f7f2a21831219c56ebd9418e498c306ad2cb8a57836fd3fa31cb028a98c',
  '0026_invoice_buyer_snapshot.sql': '33bf9fba1a918dc58a78448c019a9bac16079bef664725eedf157695f5833bba',
  '0027_auth_rate_limit.sql': '81d2fa25b09afe57a8297d2fd1cfc737f15a318686985125600abb545a2476aa',
  '0028_webhooks.sql': 'ff8d3cc17171a82255129bd3c1f41fa523edb0b9ac1b388f3a2d53bd09f111b8',
  '0029_updated_at_for_incremental_sync.sql':
    '87318a0eefe6752c096de0ac1f3a4c7c8bf5e47980293e5e0288cb12ac4ceec1',
  '0030_a_witness_to_a_seal.sql': '913237372b7bb73f5984440dac076a6a195b1d80bd2062203ec0f8ba26e80008',
  '0031_sales_invoices_status.sql': '5a586b33210314588ea8d6ae7f02a2c8c326d61726c0e74557eadfc0c2b3ff1b',
  '0032_moneybird.sql': '650b285c2d12f46031d96598f24b2a9240dbecb0abe33a2f8a08beaddf87059d',
  '0033_entities_is_demo.sql': '753f552df5843a92454cb493a640ae54b706a4f1f69366515d31c079abeaa7d5',
  '0034_moneybird_fixes.sql': '872ef07b337ec2f4d656ecb6736ac70c0d666d391952797e294fe2c7dff5197e',
}

function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

describe('merged migrations are immutable', () => {
  it(`pins checksums for 0000 through ${String(MERGED_THROUGH).padStart(4, '0')}`, () => {
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => Number(name.slice(0, 4)) <= MERGED_THROUGH)
      .sort((a, b) => a.localeCompare(b))

    expect(onDisk).toEqual(Object.keys(PINNED_CHECKSUMS).sort((a, b) => a.localeCompare(b)))

    const mismatches: string[] = []
    for (const name of onDisk) {
      const actual = sha256Utf8(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
      const expected = PINNED_CHECKSUMS[name]
      if (expected === undefined || actual !== expected) {
        mismatches.push(
          `${name}: expected ${expected ?? '(unpinned)'}, got ${actual}. ` +
            'Merged migrations are immutable — add a new file instead of editing this one.',
        )
      }
    }
    expect(mismatches).toEqual([])
  })
})
