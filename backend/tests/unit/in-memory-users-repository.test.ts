import { createInMemoryUsersRepository } from '../../src/modules/users/in-memory-users.repository.js'
import { runUsersRepositoryContract } from '../contract/users-repository.contract.js'

runUsersRepositoryContract('memoria', () => createInMemoryUsersRepository())
