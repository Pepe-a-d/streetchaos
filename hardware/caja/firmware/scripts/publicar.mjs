// Prepara un firmware ya compilado para la página de la caja (/caja/): copia sus partes (arranque,
// particiones, el programa…) con la dirección de cada una y escribe su manifest.json, que es lo que lee
// la página para instalarlo con esptool-js. Lo usa GitHub al publicar, después de `pio run -e <entorno>`.
//
//   node hardware/caja/firmware/scripts/publicar.mjs prueba dist-firmware
//   → dist-firmware/prueba/{manifest.json, bootloader.bin, partitions.bin, boot_app0.bin, firmware.bin}
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const FW = resolve(import.meta.dirname, '..')
const [env, outArg] = process.argv.slice(2)
if (!env || !outArg) {
  console.error('Uso: node publicar.mjs <entorno> <carpeta de salida>')
  process.exit(2)
}

// La versión, del -DFW_VERSION de su entorno en platformio.ini
const ini = readFileSync(join(FW, 'platformio.ini'), 'utf8')
const section = ini.split(/^\[/m).find((s) => s.startsWith(`env:${env}]`)) ?? ''
const version = section.match(/FW_VERSION=\\"([^\\"]+)\\"/)?.[1]
if (!version) throw new Error(`Sin FW_VERSION en [env:${env}]`)

// Dónde va cada parte: lo dice PlatformIO (el arranque del ESP32-S3 va en 0x0, no en 0x1000)
const meta = JSON.parse(execFileSync('pio', ['project', 'metadata', '-e', env, '--json-output'], { cwd: FW, encoding: 'utf8' }))[env]
const extra = meta?.extra
if (!extra?.flash_images?.length) throw new Error('PlatformIO no ha dado las partes del firmware (extra.flash_images)')
const app = resolve(FW, meta.prog_path.replace(/\.elf$/, '.bin'))
const parts = [...extra.flash_images.map((f) => ({ path: f.path, dir: Number(f.offset) })), { path: app, dir: Number(extra.application_offset ?? 0x10000) }]

const out = resolve(outArg, env)
mkdirSync(out, { recursive: true })
const partes = []
for (const p of parts.sort((a, b) => a.dir - b.dir)) {
  if (!existsSync(p.path)) throw new Error(`No está ${p.path}: ¿se ha compilado con pio run -e ${env}?`)
  const archivo = basename(p.path)
  copyFileSync(p.path, join(out, archivo))
  partes.push({ archivo, dir: p.dir, bytes: readFileSync(p.path).length })
}
const manifest = {
  nombre: env,
  version,
  chip: 'ESP32-S3',
  commit: (process.env.GITHUB_SHA ?? '').slice(0, 7) || null,
  fecha: new Date().toISOString(),
  partes,
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${env} ${version}: ${partes.map((p) => `${p.archivo}@0x${p.dir.toString(16)}`).join(', ')}`)
