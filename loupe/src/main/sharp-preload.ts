// Linux only. Electron's Linux binary links the system libglib and exposes its
// symbols to the whole process, while sharp's prebuilt libvips carries its own
// glib. The two collide ("GLib-GObject: g_object_ref: assertion ... failed"),
// libvips objects are never released, and a long import eventually exhausts
// memory and aborts (electron/electron#46323; sharp install docs, "Electron
// and Linux"). Loading the addon with RTLD_DEEPBIND fixes the glib binding but
// also rebinds malloc/free away from Electron's allocator, causing heap
// corruption, so that is not an option either.
//
// Instead, on Linux we point sharp at its WebAssembly build of libvips, which
// has no shared-library symbols to collide. In a worker pool it measures about
// 2.3x slower than native for thumbnailing; Windows and macOS keep the native
// build. Set LOUPE_NATIVE_SHARP=1 to force native (e.g. once upstream is fixed).
//
// Must run in every thread (worker threads have separate module caches)
// before `sharp` is first required.

import Module, { createRequire } from 'node:module'

function useWasmSharp(): void {
  if (process.platform !== 'linux' || !process.versions.electron || process.env.LOUPE_NATIVE_SHARP === '1') return
  const req = createRequire(__filename)
  let wasm: unknown
  try {
    wasm = req('@img/sharp-wasm32/sharp.node')
  } catch (err) {
    console.warn('sharp WebAssembly build not found; using native libvips', err)
    return
  }
  const cache = (Module as unknown as { _cache: Record<string, unknown> })._cache
  for (const id of [`@img/sharp-linux-${process.arch}/sharp.node`, `@img/sharp-linuxmusl-${process.arch}/sharp.node`]) {
    try {
      const file = req.resolve(id)
      cache[file] = { id: file, filename: file, loaded: true, exports: wasm, children: [], paths: [] }
    } catch {
      /* platform package not installed: sharp falls back to wasm by itself */
    }
  }
}

useWasmSharp()
