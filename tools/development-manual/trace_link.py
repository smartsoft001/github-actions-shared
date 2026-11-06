"""Attach a verified trace to one approved, existing AI OS card."""
import http.client
import json
import re
from contextlib import closing
from urllib.parse import urlencode

from langfuse_transport import ORIGIN, digest

TASK_SOURCE = '9789d202-52d5-4d3e-b75f-b4982a64e4fe'
CARD_ID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')


class NotionCard:
    def __init__(self, card_id, token):
        if not isinstance(card_id, str) or not CARD_ID.fullmatch(card_id) or not token:
            raise ValueError('invalid AI OS card configuration')
        self.id = card_id
        self._token = token
        self._children = f'/v1/blocks/{card_id}/children'

    def _request(self, method, path, payload=None):
        try:
            with closing(http.client.HTTPSConnection('api.notion.com', timeout=8)) as connection:
                connection.request(method, path, None if payload is None else json.dumps(payload),
                                   {'Authorization': 'Bearer ' + self._token, 'Notion-Version': '2025-09-03',
                                    'Content-Type': 'application/json'})
                response = connection.getresponse()
                body = response.read(1_048_577)
                if response.status != 200 or len(body) > 1_048_576:
                    raise ValueError('invalid response')
                return json.loads(body)
        except Exception:
            raise ValueError('AI OS card request failed') from None

    def verify(self):
        page = self._request('GET', f'/v1/pages/{self.id}')
        if (page.get('object') != 'page' or page.get('id') != self.id
                or page.get('archived') is not False or page.get('in_trash') is not False
                or page.get('parent', {}).get('data_source_id') != TASK_SOURCE):
            raise ValueError('approved AI OS card is unavailable')

    def contains(self, url):
        cursor = None
        for _ in range(20):
            query = {'page_size': 100}
            if cursor:
                query['start_cursor'] = cursor
            page = self._request('GET', self._children + '?' + urlencode(query))
            for block in page['results']:
                if block.get('type') == 'paragraph' and not block.get('archived'):
                    for item in block['paragraph']['rich_text']:
                        if item.get('href') == url or (item.get('text', {}).get('link') or {}).get('url') == url:
                            return True
            if page.get('has_more') is False:
                return False
            cursor = page.get('next_cursor')
            if not isinstance(cursor, str) or not cursor:
                break
        raise ValueError('could not verify all AI OS card blocks')

    def append(self, url):
        text = {'type': 'text', 'text': {'content': 'Zweryfikowany ślad testera w Langfuse', 'link': {'url': url}}}
        self._request('PATCH', self._children, {'children': [{'type': 'paragraph', 'paragraph': {'rich_text': [text]}}]})


def link_trace(card, reservations, project, trace_id):
    url = f'{ORIGIN}/project/{project}/traces/{trace_id}'
    if card.contains(url):
        return url
    # Namespace card writes separately from trace writes in the same durable store.
    namespace = f'notion:{card.id}:{project}'
    if reservations.reserve(namespace, trace_id, digest(url)):
        card.append(url)
    if not card.contains(url):
        raise ValueError('trace link publication needs read-only reconciliation')
    return url
