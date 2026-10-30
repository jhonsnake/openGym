// Original block-letter JG monogram, drawn with the project's dependency-free PNG renderer.
import { writeFileSync } from 'node:fs'
import { draw } from './app-icons.mjs'
const rows = ['11111.01110', '00100.10001', '00100.10000', '00100.10111', '10100.10001', '10100.10001', '01100.01110']
const rects = rows.flatMap((row, y) => [...row].flatMap((c, x) => c === '1' ? [[106 + x * 30, 151 + y * 30, 30, 30]] : []))
for (const size of [180, 512]) writeFileSync(new URL(`../public/johngym-v1-${size}.png`, import.meta.url), draw({ bg: '#07003c', fg: '#ffad2f' }, size, { rects }))
