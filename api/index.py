"""Public read-only Vercel adapter; never serves local files or raw upstream data."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json

import server
from build_static import sanitize_public

ALLOWED_ORIGIN = 'https://benjibrucker.github.io'


def response_for(route: str) -> tuple[int, dict]:
    if route == 'health':
        return 200, {'status': 'ok', 'app': server.APP_NAME, 'version': server.APP_VERSION, 'delivery': 'live_api'}
    if route not in {'bootstrap', 'live'}:
        return 404, {'status': 'error', 'message': 'Not found'}
    try:
        payload = server.build_payload(include_courses=route == 'bootstrap')
        if payload.get('summary', {}).get('errors') or not payload.get('events'):
            return 503, {'status': 'error', 'message': 'Upstream timing incomplete; retain last known data'}
        if route == 'bootstrap' and any(len(e.get('course', {}).get('track_points', [])) < 2 for e in payload['events']):
            return 503, {'status': 'error', 'message': 'Course data incomplete; retry shortly'}
        payload = sanitize_public(payload)
        payload['delivery'] = 'live_api'
        payload['refresh_expected_seconds'] = 15
        return 200, payload
    except Exception:
        return 503, {'status': 'error', 'message': 'Timing service unavailable; retry shortly'}


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'public, max-age=0, must-revalidate' if status == 200 else 'no-store')
        self.send_header('Vercel-CDN-Cache-Control', 'public, s-maxage=5' if status == 200 else 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parse_qs(parsed.query).get('route', [''])[0]
        if not route:
            route = parsed.path.removeprefix('/api/').strip('/')
        self._send(*response_for(route))

    def do_OPTIONS(self):
        self._send(200, {'status': 'ok'})

    def do_POST(self):
        self._send(405, {'status': 'error', 'message': 'Read-only API'})

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST
