import { createInMemoryPaymentsRepository } from '../../src/modules/payments/in-memory-payments.repository.js'
import { runPaymentsRepositoryContract } from '../contract/payments-repository.contract.js'

runPaymentsRepositoryContract('memoria', () => createInMemoryPaymentsRepository())
