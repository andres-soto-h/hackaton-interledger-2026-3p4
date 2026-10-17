import { describe, expect, it } from 'vitest'
import {
  createEmptyMerchantDirectory,
  createMerchantDirectoryFromEntries
} from '../../src/modules/transactions/merchant-directory.js'

const EPM = {
  id: 'mer_epm',
  name: 'EPM',
  walletAddress: 'https://ilp.interledger-test.dev/epm'
}

describe('MerchantDirectory', () => {
  it('encuentra un comercio por su wallet address', async () => {
    const directory = createMerchantDirectoryFromEntries([EPM])
    expect(await directory.findByWallet(EPM.walletAddress)).toEqual({
      id: 'mer_epm',
      name: 'EPM'
    })
  })

  it('ignora mayúsculas del host y la barra final', async () => {
    const directory = createMerchantDirectoryFromEntries([EPM])
    expect(await directory.findByWallet('https://ILP.interledger-test.dev/epm/')).toEqual(
      {
        id: 'mer_epm',
        name: 'EPM'
      }
    )
  })

  it('devuelve null si la wallet no es de un comercio', async () => {
    const directory = createMerchantDirectoryFromEntries([EPM])
    expect(
      await directory.findByWallet('https://ilp.interledger-test.dev/alice')
    ).toBeNull()
  })

  it('el directorio vacío no conoce ningún comercio', async () => {
    expect(
      await createEmptyMerchantDirectory().findByWallet(EPM.walletAddress)
    ).toBeNull()
  })
})
