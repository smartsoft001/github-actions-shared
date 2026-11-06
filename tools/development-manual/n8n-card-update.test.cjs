const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reconcileCard } = require('./n8n-card-update.cjs');

test('lost append response is verified by readback without a duplicate', async () => {
  const repository = 'smartsoft001/galena-mvno';
  const workflowSha = 'a'.repeat(40), sharedSha = 'b'.repeat(40);
  const head = 'c'.repeat(40), base = 'd'.repeat(40);
  const cardId = '12345678-1234-1234-1234-123456789abc';
  const enrollment = { repository, workflowSha, sharedSha, workflowId: 1, runId: 2, pr: 3, cardId };
  const evidence = {
    run: { id: 2, workflow_id: 1, repository: { full_name: repository }, head_sha: workflowSha,
      run_attempt: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
      head_branch: 'master', path: '.github/workflows/development-tester-manual.yml',
      referenced_workflows: [{ sha: sharedSha,
        path: 'smartsoft001/github-actions-shared/.github/workflows/development-tester-manual.yml@' + sharedSha }] },
    pull: { number: 3, state: 'open', head: { sha: head, repo: { full_name: repository } },
      base: { sha: base, ref: 'development', repo: { full_name: repository } } },
    report: { schema_version: 1, contract: 'development-ci-report-v1', repository, pr_number: 3,
      run_id: 2, run_attempt: 1, execution_sha: workflowSha, report_only: true, merge_eligible: false,
      result: 'passed', subject_sha256: 'e'.repeat(64), head_sha: head, base_sha: base },
    card: { id: cardId, parent: { data_source_id: '9789d202-52d5-4d3e-b75f-b4982a64e4fe' },
      archived: false, in_trash: false },
  };
  let writes = 0;
  const keys = [], reservations = new Set();
  const io = {
    readEvidence: async () => evidence,
    readMarkers: async (id) => { assert.equal(id, cardId); return [...keys]; },
    reserveMarker: async (id, marker) => {
      assert.equal(id, cardId);
      if (reservations.has(marker)) return false;
      reservations.add(marker);
      return true;
    },
    appendChild: async (id, child) => {
      assert.equal(id, cardId);
      writes++;
      keys.push(child.paragraph.rich_text[1].text.content.trim().slice(1, -1));
      throw new Error('response lost');
    },
  };
  assert.equal((await reconcileCard(enrollment, io)).verified, true);
  assert.equal((await reconcileCard(enrollment, io)).verified, true);
  assert.equal(writes, 1);
  evidence.pull.head.sha = base;
  await assert.rejects(reconcileCard(enrollment, io), /Unverified/);
  assert.equal(writes, 1);
});
