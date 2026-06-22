#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const sourceConfigPath = join(root, 'wrangler.json')
const builtConfigPath = join(root, 'dist/server/wrangler.json')

const sourceConfig = JSON.parse(readFileSync(sourceConfigPath, 'utf-8'))
const builtConfig = JSON.parse(readFileSync(builtConfigPath, 'utf-8'))

if (sourceConfig.env) {
  builtConfig.env = sourceConfig.env
  writeFileSync(builtConfigPath, JSON.stringify(builtConfig, null, 2))
  console.log('Merged env sections into dist/server/wrangler.json')
} else {
  console.log('No env sections found in source wrangler.json')
}
