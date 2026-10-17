import { createInMemoryActivityLog } from '../../src/shared/activity/in-memory-activity-log.js'
import { runActivityLogContract } from '../contract/activity-log.contract.js'

runActivityLogContract('memoria', () => {
  let nowMs = Date.UTC(2026, 9, 17, 12, 0, 0)
  return {
    log: createInMemoryActivityLog({ now: () => nowMs }),
    advance: (ms) => {
      nowMs += ms
    },
    nowMs: () => nowMs
  }
})
