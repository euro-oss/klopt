export interface WorkerConfig {
  readonly databaseUrl: string
  readonly concurrency: number
}

class MissingConfigError extends Error {
  constructor(key: string) {
    super(`Required environment variable ${key} is not set.`)
    this.name = 'MissingConfigError'
  }
}

function required(key: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') throw new MissingConfigError(key)
  return value
}

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: required('DATABASE_URL'),
    concurrency: Number.parseInt(process.env['KLOPT_WORKER_CONCURRENCY'] ?? '4', 10),
  }
}
