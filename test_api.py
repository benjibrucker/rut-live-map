import copy
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from api.index import handler, response_for
import build_static


class ApiTests(unittest.TestCase):
    def test_local_static_server_does_not_serve_project_files(self):
        import tempfile
        from pathlib import Path
        import server
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'app.js').write_text('/* synthetic public fixture */')
            (root / '.env.local').write_text('SYNTHETIC_TEST_VALUE=not-a-real-secret')
            (root / 'server.py').write_text('# synthetic private fixture')
            with patch.object(server, 'APP_ROOT', root):
                httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.RutHandler)
                thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
                base = f'http://127.0.0.1:{httpd.server_port}'
                try:
                    with urllib.request.urlopen(base + '/app.js') as response:
                        self.assertEqual(response.status, 200)
                    for path in ('/.env.local', '/server.py', '/%2eenv.local', '/.vercel/project.json'):
                        with self.assertRaises(urllib.error.HTTPError) as error:
                            urllib.request.urlopen(base + path)
                        self.assertEqual(error.exception.code, 404)
                finally:
                    httpd.shutdown(); httpd.server_close(); thread.join()

    def test_health_and_route_allowlist(self):
        self.assertEqual(response_for('health')[0], 200)
        for path in ['../server.py', 'https://example.com', 'not-found']:
            self.assertEqual(response_for(path)[0], 404)

    def test_upstream_error_is_not_served_as_new_live_data(self):
        with patch('api.index.server.build_payload', return_value={'summary':{'errors':1},'events':[{}]}):
            self.assertEqual(response_for('live')[0],503)
        with patch('api.index.server.build_payload', side_effect=RuntimeError('private diagnostic')):
            status, data=response_for('live')
            self.assertEqual(status,503)
            self.assertNotIn('private diagnostic',json.dumps(data))

    def test_live_delivery_and_minimization(self):
        payload={'summary':{'errors':0},'events':[{'runners':[{'name':'Test','age':33,'city':'Town'}], 'positions':[{'lat':45,'lng':-111,'battery_pct':88}]}]}
        with patch('api.index.server.build_payload',return_value=payload):
            status, data=response_for('live')
        self.assertEqual(status,200)
        self.assertEqual(data['delivery'],'live_api')
        self.assertEqual(data['refresh_expected_seconds'],15)
        self.assertNotIn('age',data['events'][0]['runners'][0])
        self.assertNotIn('battery_pct',data['events'][0]['positions'][0])
        self.assertIn('age',payload['events'][0]['runners'][0])

    def test_http_cors_methods_and_no_file_serving(self):
        httpd=ThreadingHTTPServer(('127.0.0.1',0),handler)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{httpd.server_port}'
        try:
            with urllib.request.urlopen(base+'/api/health') as response:
                self.assertEqual(response.status,200)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'],'https://benjibrucker.github.io')
                self.assertEqual(json.load(response)['status'],'ok')
            for path, method, expected in [('/server.py','GET',404),('/api/live','POST',405),('/api/live','DELETE',405)]:
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(urllib.request.Request(base+path,method=method))
                self.assertEqual(caught.exception.code,expected)
        finally:
            httpd.shutdown();httpd.server_close();thread.join()


if __name__=='__main__': unittest.main()
