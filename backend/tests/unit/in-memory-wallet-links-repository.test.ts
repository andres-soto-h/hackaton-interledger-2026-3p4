import { createInMemoryWalletLinksRepository } from '../../src/modules/wallet-links/in-memory-wallet-links.repository.js'
import { runWalletLinksRepositoryContract } from '../contract/wallet-links-repository.contract.js'

runWalletLinksRepositoryContract('memoria', () => createInMemoryWalletLinksRepository())
