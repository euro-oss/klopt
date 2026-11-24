import { expect, test } from '@playwright/test'

/** Throwaway CI QA: proves the aggregate `e2e` gate goes red — reverted immediately after. */
test('ci gate failure probe', () => {
  expect(1).toBe(2)
})