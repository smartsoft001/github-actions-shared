// HTTP, archive decoding and SQL are provided by the corresponding n8n nodes.
const REPO = '/repos/smartsoft001/galena-mvno';
const MAX_ARCHIVE = 1024 * 1024;
const MAX_REPORT = 64 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RESERVE = `INSERT INTO development_card_markers (card_id, marker)
VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING marker`;

function createCardConnectors({ github, downloadZip, unzip, notion, postgres, readTrace }) {
  function cardPath(id, endpoint) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid enrolled card ID');
    return `/v1/${endpoint}/${id}`;
  }

  return {
    async readEvidence(enrollment) {
      const { runId, pr, cardId } = enrollment;
      if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(pr) || pr < 1) {
        throw new Error('Invalid enrolled run or PR ID');
      }
      const [run, pull, artifacts, card] = await Promise.all([
        github('GET', `${REPO}/actions/runs/${runId}`),
        github('GET', `${REPO}/pulls/${pr}`),
        github('GET', `${REPO}/actions/runs/${runId}/artifacts?per_page=100`),
        notion('GET', cardPath(cardId, 'pages')),
      ]);
      const all = artifacts.artifacts;
      if (!Array.isArray(all) || all.length !== artifacts.total_count || all.length > 100) {
        throw new Error('Incomplete artifact inventory');
      }
      const matches = all.filter((artifact) => artifact.name === `development-ci-report-${runId}-1`);
      const artifact = matches[0];
      if (matches.length !== 1 || artifact.expired !== false ||
          !Number.isSafeInteger(artifact.id) || artifact.id < 1 ||
          !Number.isSafeInteger(artifact.size_in_bytes) ||
          artifact.size_in_bytes < 1 || artifact.size_in_bytes > MAX_ARCHIVE ||
          (artifact.workflow_run && artifact.workflow_run.id !== runId)) {
        throw new Error('Invalid or ambiguous CI report artifact');
      }
      const archive = await downloadZip(`${REPO}/actions/artifacts/${artifact.id}/zip`, MAX_ARCHIVE);
      if (!Buffer.isBuffer(archive) || archive.length > MAX_ARCHIVE) throw new Error('Invalid artifact archive');
      const files = await unzip(archive, { maxFiles: 1, maxBytes: MAX_REPORT });
      if (!Array.isArray(files) || files.length !== 1 || files[0].name !== 'ci-report.json' ||
          !Buffer.isBuffer(files[0].data) || files[0].data.length > MAX_REPORT) {
        throw new Error('Invalid CI report archive contents');
      }
      const report = JSON.parse(files[0].data.toString('utf8'));
      const trace = readTrace ? await readTrace(enrollment, report) : undefined;
      return { run, pull, card, report, trace };
    },

    async readMarkers(cardId, expectedLinks = []) {
      const endpoint = cardPath(cardId, 'blocks') + '/children?page_size=100';
      const markers = [], seen = new Set();
      const expected = new Map(expectedLinks.map(({ key, url }) => [key, url]));
      let cursor;
      for (let page = 0; page < 20; page++) {
        const result = await notion('GET', endpoint + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
        if (!Array.isArray(result.results)) throw new Error('Invalid Notion block inventory');
        for (const block of result.results) {
          if (block.type !== 'paragraph' || block.archived || block.in_trash) continue;
          for (const item of block.paragraph?.rich_text ?? []) {
            const value = item.text?.content?.trim();
            const match = /^\[(development-ci:[1-9]\d*:1(?::trace:[a-f0-9]{32})?)\]$/.exec(value ?? '');
            if (match) {
              const key = match[1];
              if (markers.includes(key)) throw new Error('Duplicate Notion marker');
              if (expected.has(key)) {
                const urls = block.paragraph.rich_text
                  .map((text) => text.text?.link?.url ?? text.href)
                  .filter((url) => url != null);
                if (urls.length !== 1 || urls[0] !== expected.get(key)) {
                  throw new Error('Notion marker URL does not match the verified link');
                }
              }
              markers.push(key);
            }
          }
        }
        if (result.has_more === false) return markers;
        cursor = result.next_cursor;
        if (result.has_more !== true || typeof cursor !== 'string' || !cursor || seen.has(cursor)) break;
        seen.add(cursor);
      }
      throw new Error('Incomplete Notion block inventory');
    },

    async reserveMarker(cardId, marker) {
      cardPath(cardId, 'blocks');
      const rows = await postgres(RESERVE, [cardId, marker]);
      if (!Array.isArray(rows) || rows.length > 1 || (rows.length === 1 && rows[0].marker !== marker)) {
        throw new Error('Invalid reservation result');
      }
      return rows.length === 1;
    },

    async appendChild(cardId, child) {
      await notion('PATCH', cardPath(cardId, 'blocks') + '/children', { children: [child] });
    },
  };
}

module.exports = { createCardConnectors };
