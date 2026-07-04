import { describe, it, expect } from 'vitest'
import { Asset } from '@stellar/stellar-sdk'

// Infra smoke test: proves both the Vitest runner AND that @stellar/stellar-sdk
// imports cleanly under test (it will be imported by the XDR validator next).
// No product logic here — delete or replace once real specs exist.
describe('vitest infra smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2)
  })

  it('imports @stellar/stellar-sdk cleanly', () => {
    expect(Asset).toBeDefined()
    expect(Asset.native().isNative()).toBe(true)
  })
})
