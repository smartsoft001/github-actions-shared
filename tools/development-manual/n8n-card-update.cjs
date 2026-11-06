// Planner for the trusted n8n consumer. Inputs come from its enrollment and API nodes.
const repo = 'smartsoft001/galena-mvno';
const langfuse = 'https://langfuse.smartsoft.biz.pl';
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function planCardUpdate({ enrollment, run, pull, report, card, existingKeys, trace }) {
  const check = (condition) => {
    if (!condition) throw new Error('Unverified Development report or card binding');
  };
  check(enrollment.repository === repo && sha.test(enrollment.workflowSha) &&
    Number.isSafeInteger(enrollment.workflowId) && Number.isSafeInteger(enrollment.pr) &&
    Number.isSafeInteger(enrollment.runId) && uuid.test(enrollment.cardId));
  check(run.id === enrollment.runId && run.workflow_id === enrollment.workflowId &&
    run.repository?.full_name === repo && run.head_sha === enrollment.workflowSha &&
    run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success' &&
    run.event === 'workflow_dispatch' && run.head_branch === 'master' &&
    run.path === '.github/workflows/development-tester-manual.yml' &&
    sha.test(enrollment.sharedSha) && run.referenced_workflows?.some(
      (workflow) => workflow.sha === enrollment.sharedSha &&
        workflow.path === 'smartsoft001/github-actions-shared/.github/workflows/development-tester-manual.yml@' + enrollment.sharedSha));
  check(report.schema_version === 1 && report.contract === 'development-ci-report-v1' &&
    report.repository === repo && report.pr_number === enrollment.pr &&
    report.run_id === run.id && report.run_attempt === 1 && report.execution_sha === run.head_sha &&
    report.report_only === true && report.merge_eligible === false && report.result === 'passed' &&
    hash.test(report.subject_sha256) && sha.test(report.head_sha) && sha.test(report.base_sha));
  check(pull.number === enrollment.pr && pull.state === 'open' && pull.head?.sha === report.head_sha &&
    pull.base?.sha === report.base_sha && pull.base.ref === 'development' &&
    pull.head?.repo?.full_name === repo && pull.base?.repo?.full_name === repo);
  check(card.id === enrollment.cardId && card.parent?.data_source_id === '9789d202-52d5-4d3e-b75f-b4982a64e4fe' &&
    card.archived === false && card.in_trash === false && Array.isArray(existingKeys));

  const key = `development-ci:${run.id}:1`;
  const links = [{ key, label: 'Raport testów GitHub Actions', url: `https://github.com/${repo}/actions/runs/${run.id}` }];
  if (trace != null) {
    check(typeof enrollment.projectId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(enrollment.projectId) &&
      trace.provider === 'langfuse' && trace.origin === langfuse &&
      trace.project_id === enrollment.projectId && trace.acknowledged === true && trace.readback_verified === true &&
      trace.run_id === run.id && trace.run_attempt === 1 && trace.execution_sha === run.head_sha &&
      trace.subject_sha256 === report.subject_sha256 && /^[a-f0-9]{32}$/.test(trace.trace_id));
    links.push({ key: `${key}:trace:${trace.trace_id}`, label: 'Zweryfikowany ślad modelu',
      url: `${langfuse}/project/${trace.project_id}/traces/${trace.trace_id}` });
  }
  const children = links.filter((link) => !existingKeys.includes(link.key)).map(({ key, label, url }) => ({
    type: 'paragraph',
    paragraph: { rich_text: [
      { type: 'text', text: { content: label, link: { url } } },
      { type: 'text', text: { content: ` [${key}]` } },
    ] },
  }));
  return { cardId: card.id, children };
}

if (typeof module !== 'undefined') module.exports = { planCardUpdate };

// n8n supplies authenticated connectors and a durable, atomic reservation store.
// A reservation survives an ambiguous append, so a retry only reads that block.
async function reconcileCard(enrollment, io) {
  const { run, pull, report, card, trace } = await io.readEvidence(enrollment);
  const existingKeys = await io.readMarkers(enrollment.cardId);
  const plan = planCardUpdate({ enrollment, run, pull, report, card, existingKeys, trace });
  const outcomes = [];
  for (const child of plan.children) {
    const marker = child.paragraph.rich_text[1].text.content.trim();
    if (await io.reserveMarker(plan.cardId, marker)) {
      try {
        await io.appendChild(plan.cardId, child);
      } catch {
        // The request may have committed. Read back before reporting its outcome.
      }
    }
    const visible = await io.readMarkers(plan.cardId);
    outcomes.push({ marker, verified: visible.includes(marker.slice(1, -1)) });
  }
  return { cardId: plan.cardId, outcomes, verified: outcomes.every((entry) => entry.verified) };
}

if (typeof module !== 'undefined') module.exports.reconcileCard = reconcileCard;
