// Must be imported first: sizes libuv's thread pool (shared by fs and sharp)
// before anything touches it.
import { cpus } from 'node:os'

process.env.UV_THREADPOOL_SIZE = String(Math.max(8, Math.min(24, cpus().length * 2)))
