// electron-builder afterPack hook for Windows builds made on Linux. Sets the
// app exe's icon and version info with resedit (pure JS) — electron-builder's
// own editor, rcedit, needs Wine there. Without this the exe shows Electron's
// icon in Explorer, the taskbar and shortcuts, and "Electron" in Task Manager.
const fs = require('node:fs')
const path = require('node:path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

// .ico with PNG-compressed images (supported by Windows Vista and later).
async function makeIco(png) {
  const sharp = require('sharp')
  const images = await Promise.all(SIZES.map((s) => sharp(png).resize(s, s).png().toBuffer()))
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((img, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(SIZES[i] >= 256 ? 0 : SIZES[i], e)
    header.writeUInt8(SIZES[i] >= 256 ? 0 : SIZES[i], e + 1)
    header.writeUInt16LE(1, e + 4) // planes
    header.writeUInt16LE(32, e + 6) // bits per pixel
    header.writeUInt32LE(img.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += img.length
  })
  return Buffer.concat([header, ...images])
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const R = await require('resedit/cjs').load()
  const { productFilename, productName, version } = context.packager.appInfo
  const copyright = context.packager.config.copyright ?? ''
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`)

  const exe = R.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const res = R.NtExecutableResource.from(exe)

  const ico = R.Data.IconFile.from(await makeIco(path.join(__dirname, '..', 'build', 'icon.png')))
  const group = R.Resource.IconGroupEntry.fromEntries(res.entries)[0]
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group?.id ?? 1, group?.lang ?? 1033, ico.icons.map((i) => i.data))

  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0]
  const lang = vi.getAvailableLanguages()[0] ?? { lang: 1033, codepage: 1200 }
  const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  vi.setFileVersion(major, minor, patch, 0, lang.lang)
  vi.setProductVersion(major, minor, patch, 0, lang.lang)
  vi.setStringValues(lang, {
    CompanyName: productName,
    FileDescription: productName,
    FileVersion: version,
    InternalName: productName,
    LegalCopyright: copyright,
    OriginalFilename: `${productFilename}.exe`,
    ProductName: productName,
    ProductVersion: version
  })
  vi.removeStringValue(lang, 'SquirrelAwareVersion')
  vi.outputToResourceEntries(res.entries)

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`  • set icon and version info  file=${path.basename(exePath)}`)
}
