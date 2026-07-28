import assert from 'node:assert/strict'
import test from 'node:test'
import { createCorsPolicy } from './cors-policy.js'

test('production is fail-closed when no browser origins are configured', () => {
  const policy = createCorsPolicy({ NODE_ENV: 'production' })

  assert.equal(policy.allows(undefined), true)
  assert.equal(policy.allows('https://example.invalid'), false)
  assert.equal(policy.allows('http://localhost:5173'), false)
})

test('Render is treated as production even without NODE_ENV', () => {
  const policy = createCorsPolicy({ RENDER: 'true' })

  assert.equal(policy.allowLocalhost, false)
  assert.equal(policy.allows('http://localhost:5173'), false)
})

test('development permits only loopback origins by default', () => {
  const policy = createCorsPolicy({ NODE_ENV: 'development' })

  assert.equal(policy.allows('http://localhost:5173'), true)
  assert.equal(policy.allows('https://127.0.0.1:4173'), true)
  assert.equal(policy.allows('http://[::1]:5173'), true)
  assert.equal(policy.allows('http://localhost.example.com:5173'), false)
  assert.equal(policy.allows('https://example.invalid'), false)
})

test('exact origins are normalized, deduplicated and matched exactly', () => {
  const policy = createCorsPolicy({
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://app.example.com/, https://app.example.com, http://localhost:4173',
  })

  assert.deepEqual(policy.exactOrigins, ['https://app.example.com', 'http://localhost:4173'])
  assert.equal(policy.allows('https://app.example.com'), true)
  assert.equal(policy.allows('https://sub.app.example.com'), false)
  assert.equal(policy.allows('https://app.example.com.evil.invalid'), false)
  assert.equal(policy.allows('http://localhost:4173'), true)
  assert.equal(policy.allows('http://localhost:5173'), false)
})

test('configured Vercel previews require the project and team slugs', () => {
  const policy = createCorsPolicy({
    NODE_ENV: 'production',
    ALLOWED_VERCEL_PREVIEWS: 'aqua-scheme:mokydeks-projects',
  })

  assert.equal(policy.allows('https://aqua-scheme-ewtlc1k97-mokydeks-projects.vercel.app'), true)
  assert.equal(policy.allows('https://aqua-scheme-git-main-mokydeks-projects.vercel.app'), true)
  assert.equal(policy.allows('https://other-ewtlc1k97-mokydeks-projects.vercel.app'), false)
  assert.equal(policy.allows('https://aqua-scheme-ewtlc1k97-other-team.vercel.app'), false)
  assert.equal(policy.allows('http://aqua-scheme-ewtlc1k97-mokydeks-projects.vercel.app'), false)
  assert.equal(policy.allows('https://aqua-scheme-mokydeks-projects.vercel.app'), false)
})

test('a production Vercel alias still requires an exact origin entry', () => {
  const previewsOnly = createCorsPolicy({
    NODE_ENV: 'production',
    ALLOWED_VERCEL_PREVIEWS: 'aqua-scheme:mokydeks-projects',
  })
  const withProduction = createCorsPolicy({
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://aqua-scheme-theta.vercel.app',
    ALLOWED_VERCEL_PREVIEWS: 'aqua-scheme:mokydeks-projects',
  })

  assert.equal(previewsOnly.allows('https://aqua-scheme-theta.vercel.app'), false)
  assert.equal(withProduction.allows('https://aqua-scheme-theta.vercel.app'), true)
})

test('ALLOW_LOCALHOST can explicitly override the environment default', () => {
  assert.equal(createCorsPolicy({ NODE_ENV: 'development', ALLOW_LOCALHOST: 'false' })
    .allows('http://localhost:5173'), false)
  assert.equal(createCorsPolicy({ NODE_ENV: 'production', ALLOW_LOCALHOST: 'true' })
    .allows('http://localhost:5173'), true)
})

test('unsafe or malformed configuration fails at startup', () => {
  assert.throws(() => createCorsPolicy({ ALLOWED_ORIGINS: '*' }), /must not contain \*/)
  assert.throws(() => createCorsPolicy({ ALLOWED_ORIGINS: 'https:\/\/app.example.com\/path' }), /must be origins/)
  assert.throws(() => createCorsPolicy({ ALLOWED_ORIGINS: 'javascript:alert(1)' }), /only http/)
  assert.throws(() => createCorsPolicy({ ALLOWED_VERCEL_PREVIEWS: 'aqua-scheme' }), /project:team/)
  assert.throws(() => createCorsPolicy({ ALLOWED_VERCEL_PREVIEWS: 'Aqua_Scheme:team' }), /invalid Vercel/)
  assert.throws(() => createCorsPolicy({ ALLOW_LOCALHOST: 'sometimes' }), /must be true or false/)
})

test('malformed, opaque and path-bearing Origin headers are denied', () => {
  const policy = createCorsPolicy({ ALLOWED_ORIGINS: 'https://app.example.com' })

  assert.equal(policy.allows('null'), false)
  assert.equal(policy.allows('not a URL'), false)
  assert.equal(policy.allows('https://app.example.com/path'), false)
  assert.equal(policy.allows('https://user@app.example.com'), false)
})
