const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCardConnectors } = require('./n8n-card-connectors.cjs');
const { reconcileCard } = require('./n8n-card-update.cjs');

const {sandbox}=require('./n8n-card-fixture.cjs');

test('composed adapters publish both links once across concurrent callers and restart', async () => {
  const s = sandbox();
  s.loseResponse();
  const results = await Promise.all(Array.from({ length: 8 }, () => reconcileCard(s.enrollment, s.connect())));
  assert.ok(results.every(result => result.verified));
  assert.equal(s.writes, 2);
  assert.equal(s.blocks.length, 2);
  assert.equal(s.reservations.size, 2);
  assert.equal((await reconcileCard(s.enrollment, s.connect())).verified, true);
  assert.equal(s.writes, 2);
});

test('ambiguous write without visible block stays blocked across fresh connector instances', async () => {
  const s = sandbox();
  s.checksOnly(); s.loseResponse(); s.dropWrite();
  assert.equal((await reconcileCard(s.enrollment, s.connect())).verified, false);
  assert.equal((await reconcileCard(s.enrollment, s.connect())).verified, false);
  assert.equal(s.writes, 1);
  assert.equal(s.reservations.size, 1);
});

test('an existing marker with the wrong URL cannot masquerade as verified readback', async () => {
  const s = sandbox();
  await reconcileCard(s.enrollment, s.connect());
  s.blocks[0].paragraph.rich_text[0].text.link.url = 'https://github.com/unrelated/repo/actions/runs/2';
  await assert.rejects(reconcileCard(s.enrollment, s.connect()), /link|URL/i);
  assert.equal(s.writes, 2);
});

test('duplicate marker blocks are detected instead of being declared verified', async () => {
  const s = sandbox();
  await reconcileCard(s.enrollment, s.connect());
  s.blocks.push(structuredClone(s.blocks[0]));
  await assert.rejects(reconcileCard(s.enrollment, s.connect()), /duplicate/i);
  assert.equal(s.writes, 2);
});

for (const [name, mutate] of [
  ['changed head', s => { s.pull.head.sha = '9'.repeat(40); }],
  ['changed base', s => { s.pull.base.sha = '9'.repeat(40); }],
  ['other card source', s => { s.card.parent.data_source_id = 'other'; }],
  ['unverified trace', s => { s.trace.readback_verified = false; }],
  ['wrong trace run', s => { s.trace.run_id = 3; }],
  ['wrong trace project', s => { s.trace.project_id = 'other'; }],
]) {
  test(`${name} fails before reservation or Notion write`, async () => {
    const s = sandbox(); mutate(s);
    await assert.rejects(reconcileCard(s.enrollment, s.connect()), /Unverified/);
    assert.equal(s.writes, 0);
    assert.equal(s.reservations.size, 0);
  });
}

const TELE_SCOPE = { repository: 'smartsoft001/galena-tele' };
test('Tele uses the same report/trace reconciler and host claim port, once across concurrent retries', async () => {
 const s=sandbox(TELE_SCOPE.repository,true);s.loseResponse();
 const results=await Promise.all(Array.from({length:8},()=>reconcileCard(s.enrollment,s.connect(),TELE_SCOPE)));
 assert.ok(results.every(r=>r.verified));assert.equal(s.writes,2);assert.equal(s.blocks.length,2);
 assert.equal(s.blocks[0].paragraph.rich_text[0].text.link.url,'https://github.com/smartsoft001/galena-tele/actions/runs/2');
 assert.equal((await reconcileCard(s.enrollment,s.connect(),TELE_SCOPE)).verified,true);assert.equal(s.writes,2);
});
test('Tele keeps an ambiguous missing append reserved without another write',async()=>{
 const s=sandbox(TELE_SCOPE.repository,true);s.checksOnly();s.dropWrite();s.loseResponse();
 assert.equal((await reconcileCard(s.enrollment,s.connect(),TELE_SCOPE)).verified,false);
 assert.equal((await reconcileCard(s.enrollment,s.connect(),TELE_SCOPE)).verified,false);assert.equal(s.writes,1);
});
test('Tele evidence cannot select its own scope or update a card with a changed final head',async()=>{
 const s=sandbox(TELE_SCOPE.repository,true);
 await assert.rejects(reconcileCard(s.enrollment,s.connect()),/Unverified/);assert.equal(s.writes,0);
 s.pull.head.sha='9'.repeat(40);await assert.rejects(reconcileCard(s.enrollment,s.connect(),TELE_SCOPE),/Unverified/);assert.equal(s.writes,0);
});
test('unsupported host scope and malformed claim results fail before a card append',async()=>{
 assert.throws(()=>createCardConnectors({scope:{repository:'unrelated/project'}}),/scope/);
 const ports=createCardConnectors({scope:TELE_SCOPE,claimMarker:async()=>({claimed:true})});
 await assert.rejects(ports.reserveMarker('12345678-1234-1234-1234-123456789abc','marker'),/reservation/);
});
