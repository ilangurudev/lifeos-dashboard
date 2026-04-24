import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chooseHermesFinalReply, looksLikeUselessReply, readHermesSessionReply } from './hermesSession.ts'

async function main() {
  assert.equal(looksLikeUselessReply('Link: prep-for-laya-passport-appointment'), true)
  assert.equal(looksLikeUselessReply('Laya’s passport appointment was Friday, April 17, 2026 at 10:30 AM EDT.'), false)

  const fullReply = [
    'Laya’s passport appointment was Friday, April 17, 2026 at 10:30 AM EDT.',
    '',
    'Tiny wrinkle: it already happened — the task says it went alright.',
    '',
    'Link: [prep-for-laya-passport-appointment](http://impetus.tail168188.ts.net:3007/note/prep-for-laya-passport-appointment)',
  ].join('\n')

  assert.equal(chooseHermesFinalReply('Link: prep-for-laya-passport-appointment', fullReply), fullReply)
  assert.equal(chooseHermesFinalReply('Direct parsed reply', ''), 'Direct parsed reply')

  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lifeos-hermes-session-'))
  const sessionDir = path.join(tempHome, '.hermes', 'sessions')
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.writeFile(
    path.join(sessionDir, 'session_20260424_081648_ca3dc6.json'),
    JSON.stringify({
      messages: [
        { role: 'user', content: 'User message:\nWhen do i go for laya\'s passport appointment?' },
        { role: 'assistant', content: fullReply },
      ],
    }),
  )

  assert.equal(await readHermesSessionReply('20260424_081648_ca3dc6', tempHome, 1), fullReply)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
