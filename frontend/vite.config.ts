import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import selfsigned from 'selfsigned'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const backendEnvPath = path.resolve(repoRoot, 'backend', '.env')
const runtimeHttpsDir = path.resolve(repoRoot, '.runtime', 'frontend-https')
const runtimeHttpsMetaPath = path.resolve(runtimeHttpsDir, 'metadata.json')
const runtimeHttpsCertPath = path.resolve(runtimeHttpsDir, 'server.crt')
const runtimeHttpsKeyPath = path.resolve(runtimeHttpsDir, 'server.key')

type AltNameEntry = {
  ip?: string
  type: 1 | 2 | 6 | 7
  value?: string
}

function readLanHost(): string {
  const defaultLanHost = '127.0.0.1'

  if (!fs.existsSync(backendEnvPath)) {
    return defaultLanHost
  }

  const fileContents = fs.readFileSync(backendEnvPath, 'utf8')
  const match = fileContents.match(/^LAN_HOST=(.+)$/m)

  if (!match) {
    return defaultLanHost
  }

  return match[1].trim().replace(/^["']|["']$/g, '') || defaultLanHost
}

function buildSubjectAltNames(lanHost: string) {
  const altNames: AltNameEntry[] = [
    { type: 2, value: 'localhost' },
    { ip: '127.0.0.1', type: 7 },
  ]

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lanHost)) {
    altNames.push({ ip: lanHost, type: 7 })
  } else {
    altNames.push({ type: 2, value: lanHost })
  }

  return altNames
}

async function ensureHttpsCertificate(lanHost: string): Promise<{ cert: string; key: string }> {
  const desiredMetadata = JSON.stringify({ lanHost }, null, 2)

  if (
    fs.existsSync(runtimeHttpsCertPath) &&
    fs.existsSync(runtimeHttpsKeyPath) &&
    fs.existsSync(runtimeHttpsMetaPath)
  ) {
    const currentMetadata = fs.readFileSync(runtimeHttpsMetaPath, 'utf8')
    if (currentMetadata === desiredMetadata) {
      return {
        cert: fs.readFileSync(runtimeHttpsCertPath, 'utf8'),
        key: fs.readFileSync(runtimeHttpsKeyPath, 'utf8'),
      }
    }
  }

  fs.mkdirSync(runtimeHttpsDir, { recursive: true })

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: lanHost }],
    {
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3650),
      extensions: [
        {
          altNames: buildSubjectAltNames(lanHost),
          name: 'subjectAltName',
        },
      ],
    },
  )

  fs.writeFileSync(runtimeHttpsCertPath, pems.cert)
  fs.writeFileSync(runtimeHttpsKeyPath, pems.private)
  fs.writeFileSync(runtimeHttpsMetaPath, desiredMetadata)

  return {
    cert: pems.cert,
    key: pems.private,
  }
}

const lanHost = readLanHost()

// Serve the Vite dev app over HTTPS so camera capture works on LAN IPs.
export default defineConfig(async () => {
  const httpsCredentials = await ensureHttpsCertificate(lanHost)

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      https: httpsCredentials,
      proxy: {
        '/api': {
          changeOrigin: true,
          target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:4000',
        },
      },
    },
  }
})
