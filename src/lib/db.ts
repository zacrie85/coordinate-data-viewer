import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Load DATABASE_URL from project .env file if the system-level env var
 * has an incorrect value (e.g., points to a local SQLite file).
 * On Vercel, the dashboard-set DATABASE_URL will be correct and used as-is.
 */
if (!process.env.DATABASE_URL?.startsWith('postgresql')) {
  try {
    const envPath = join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf8')
    for (const line of envContent.split('\n')) {
      const m = line.match(/^DATABASE_URL=["'](.+?)["']\s*$/)
      if (m) {
        process.env.DATABASE_URL = m[1]
        break
      }
    }
  } catch { /* .env not found, keep system value */ }
}

if (!process.env.DIRECT_URL?.startsWith('postgresql')) {
  try {
    const envPath = join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf8')
    for (const line of envContent.split('\n')) {
      const m = line.match(/^DIRECT_URL=["'](.+?)["']\s*$/)
      if (m) {
        process.env.DIRECT_URL = m[1]
        break
      }
    }
  } catch { /* .env not found */ }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
