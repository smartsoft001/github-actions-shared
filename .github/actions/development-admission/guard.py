"""Receiver-side read-only admission. No model, shell dispatch or source writes."""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

KEY = re.compile(r'[A-Z][A-Z0-9]{1,15}-[1-9][0-9]{0,8}')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
REPO = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+')
QUERY = ('query DevelopmentReceiverAdmission($id:String!,$after:String){'
         'issue(id:$id){id identifier labels(first:100,after:$after){'
         'nodes{id name}pageInfo{hasNextPage endCursor}}}}')


class Denied(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def load_registry(file):
    data = json.loads(Path(file).read_text())
    if set(data) != {'schema_version', 'entries'} or data['schema_version'] != 1 or not isinstance(data['entries'], list):
        raise Denied('invalid-registry')
    ids, keys = set(), set()
    for item in data['entries']:
        if (set(item) != {'issue_id', 'issue_key', 'repository', 'reason'}
                or not UUID.fullmatch(item['issue_id']) or not KEY.fullmatch(item['issue_key'])
                or not REPO.fullmatch(item['repository']) or not item['reason']
                or item['issue_id'] in ids or item['issue_key'] in keys):
            raise Denied('invalid-registry')
        ids.add(item['issue_id'])
        keys.add(item['issue_key'])
    return data['entries']


def linear_read(token, variables):
    request = urllib.request.Request('https://api.linear.app/graphql',
        data=json.dumps({'query': QUERY, 'variables': variables}).encode(),
        headers={'Authorization': token, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
        raw = response.read(1048577)
        if response.status != 200 or len(raw) > 1048576:
            raise Denied('readback-failed')
    return json.loads(raw)


def admit(issue_key, repository, token, registry_file, *, read=linear_read):
    if not isinstance(issue_key, str) or not KEY.fullmatch(issue_key) or not REPO.fullmatch(repository or ''):
        raise Denied('invalid-identity')
    registry = load_registry(registry_file)
    # Quarantine follows the enrolled issue, even when a wrong repo invokes it.
    if any(item['issue_key'] == issue_key for item in registry):
        raise Denied('coordinator-owned')
    if not isinstance(token, str) or not token.strip():
        raise Denied('missing-read-credential')
    cursor, seen, labels, identity = None, set(), set(), None
    for _ in range(20):
        response = read(token, {'id': issue_key, 'after': cursor})
        issue = response.get('data', {}).get('issue')
        if response.get('errors') or not isinstance(issue, dict):
            raise Denied('readback-failed')
        current = (issue.get('id'), issue.get('identifier'))
        if (not UUID.fullmatch(current[0] or '') or current[1] != issue_key
                or identity is not None and current != identity):
            raise Denied('readback-identity-mismatch')
        identity = current
        if any(item['issue_id'] == issue['id'] for item in registry):
            raise Denied('coordinator-owned')
        connection = issue.get('labels', {})
        nodes, page = connection.get('nodes'), connection.get('pageInfo', {})
        if not isinstance(nodes, list):
            raise Denied('incomplete-label-inventory')
        for label in nodes:
            if not isinstance(label, dict) or not UUID.fullmatch(label.get('id', '')) or not isinstance(label.get('name'), str) or label['id'] in labels:
                raise Denied('incomplete-label-inventory')
            labels.add(label['id'])
            if label['name'] == 'AI Skip CI':
                raise Denied('ai-skip-ci')
        if page.get('hasNextPage') is False:
            return {'allowed': True, 'reason': 'linear-readback-verified',
                    'issue_key': issue_key, 'repository': repository, 'model_calls': 0}
        next_cursor = page.get('endCursor')
        if page.get('hasNextPage') is not True or not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen:
            raise Denied('incomplete-label-inventory')
        seen.add(next_cursor)
        cursor = next_cursor
    raise Denied('label-page-limit')


def main():
    try:
        result = admit(os.environ.get('ADMISSION_ISSUE_ID'), os.environ.get('GITHUB_REPOSITORY'),
            os.environ.get('LINEAR_API_KEY'), Path(__file__).with_name('ownership.json'))
    except Denied as error:
        result = {'allowed': False, 'reason': str(error), 'model_calls': 0}
    except Exception:
        # Never print provider response bodies, credentials or exception text.
        result = {'allowed': False, 'reason': 'admission-unavailable', 'model_calls': 0}
    output = os.environ.get('GITHUB_OUTPUT')
    if not output:
        raise RuntimeError('GitHub output channel required')
    with open(output, 'a') as target:
        target.write('allowed=' + str(result['allowed']).lower() + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
