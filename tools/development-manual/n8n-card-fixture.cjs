'use strict';
// Synthetic API/claim fixture only; no clients or credentials.
const assert=require('node:assert/strict');
const {createCardConnectors}=require('./n8n-card-connectors.cjs');
function sandbox(repository = 'smartsoft001/galena-mvno', useClaimPort = false) {
  const workflowSha = 'a'.repeat(40), sharedSha = 'b'.repeat(40);
  const cardId = '12345678-1234-1234-1234-123456789abc';
  const enrollment = { repository, workflowSha, sharedSha, workflowId: 1, runId: 2, pr: 3, cardId,
    projectId: 'isolated-test' };
  const run = { id: 2, workflow_id: 1, repository: { full_name: repository }, head_sha: workflowSha,
    run_attempt: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
    head_branch: 'master', path: '.github/workflows/development-tester-manual.yml',
    referenced_workflows: [{ sha: sharedSha,
      path: 'smartsoft001/github-actions-shared/.github/workflows/development-tester-manual.yml@' + sharedSha }] };
  const pull = { number: 3, state: 'open', head: { sha: 'c'.repeat(40), repo: { full_name: repository } },
    base: { sha: 'd'.repeat(40), ref: 'development', repo: { full_name: repository } } };
  const report = { schema_version: 1, contract: 'development-ci-report-v1', repository, pr_number: 3,
    run_id: 2, run_attempt: 1, execution_sha: workflowSha, report_only: true, merge_eligible: false,
    result: 'passed', subject_sha256: 'e'.repeat(64), head_sha: pull.head.sha, base_sha: pull.base.sha };
  const card = { id: cardId, parent: { data_source_id: '9789d202-52d5-4d3e-b75f-b4982a64e4fe' },
    archived: false, in_trash: false };
  const trace = { provider: 'langfuse', origin: 'https://langfuse.smartsoft.biz.pl',
    project_id: enrollment.projectId, acknowledged: true, readback_verified: true,
    run_id: 2, run_attempt: 1, execution_sha: workflowSha, subject_sha256: report.subject_sha256,
    trace_id: 'f'.repeat(32) };
  const blocks = [], reservations = new Set();
  let writes = 0, loseResponse = false, dropWrite = false, includeTrace = true;
  const scope = { repository };
  const claimMarker = async (id, marker) => {
    const key = id + marker;if(reservations.has(key)) return false;reservations.add(key);return true;
  };
  const connect = () => createCardConnectors({
    scope, ...(useClaimPort ? { claimMarker } : {}),
    github: async (method, path) => {
      assert.equal(method, 'GET');
      assert.ok(path.startsWith('/repos/' + repository + '/'));
      if (path.endsWith('/artifacts?per_page=100')) return { total_count: 1, artifacts: [
        { id: 9, name: 'development-ci-report-2-1', size_in_bytes: 10, expired: false, workflow_run: { id: 2 } },
      ] };
      if (path.endsWith('/runs/2')) return run;
      if (path.endsWith('/pulls/3')) return pull;
      throw new Error('Unexpected GitHub route');
    },
    downloadZip: async url => { assert.equal(url, '/repos/' + repository + '/actions/artifacts/9/zip'); return Buffer.from('zip-fixture'); },
    unzip: async () => [{ name: 'ci-report.json', data: Buffer.from(JSON.stringify(report)) }],
    readTrace: async () => includeTrace ? trace : undefined,
    notion: async (method, path, body) => {
      if (method === 'GET' && path === `/v1/pages/${cardId}`) return card;
      if (method === 'GET' && path === `/v1/blocks/${cardId}/children?page_size=100`) {
        return { results: structuredClone(blocks), has_more: false };
      }
      assert.equal(method, 'PATCH');
      assert.equal(path, `/v1/blocks/${cardId}/children`);
      writes++;
      if (!dropWrite) blocks.push(...structuredClone(body.children));
      if (loseResponse) throw new Error('Lost response after commit');
      return {};
    },
    postgres: async (sql, [id, marker]) => {
      assert.equal(useClaimPort, false, 'existing host claim port must not fall back to SQL');
      assert.equal(id, cardId);
      assert.match(sql, /ON CONFLICT DO NOTHING/);
      const key = id + marker;
      if (reservations.has(key)) return [];
      reservations.add(key);
      return [{ marker }];
    },
  });
  return { enrollment, run, pull, report, card, trace, blocks, reservations, connect,
    get writes() { return writes; },
    loseResponse() { loseResponse = true; },
    dropWrite() { dropWrite = true; },
    checksOnly() { includeTrace = false; } };
}


module.exports={sandbox};
