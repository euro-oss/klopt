import { PgBoss } from 'pg-boss'
import { loadConfig } from './config.js'
import { jobsFor, registerJobs } from './jobs.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // Its own schema, so queue tables never show up in a dump of the books.
  const boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'klopt_jobs' })

  boss.on('error', (error: unknown) => {
    console.error('[worker] pg-boss error', error)
  })

  await boss.start()
  const jobs = jobsFor(config.databaseUrl)
  await registerJobs(boss, jobs)
  console.info(`[worker] started with ${String(jobs.length)} job(s)`)

  const shutdown = (signal: string): void => {
    console.info(`[worker] ${signal} received, draining`)
    void boss.stop({ graceful: true }).then(
      () => {
        process.exit(0)
      },
      (error: unknown) => {
        console.error('[worker] shutdown failed', error)
        process.exit(1)
      },
    )
  }

  process.on('SIGINT', () => {
    shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    shutdown('SIGTERM')
  })
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error)
  process.exit(1)
})
