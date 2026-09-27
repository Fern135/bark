"""Exercise production Nginx routing with loopback peers and an echo upstream.

Set BARK_TEST_NGINX to a native nginx executable. No Docker, cloud, or TLS required;
this checks Nginx's trust boundary, not Caddy or the public deployment.
"""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest


class Echo(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = json.dumps({key.lower(): value for key, value in self.headers.items()}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@unittest.skipUnless(os.environ.get('BARK_TEST_NGINX'), 'Set BARK_TEST_NGINX to run live gateway checks')
class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        root = Path(cls.temp.name)
        (root / 'logs').mkdir()
        (root / 'temp').mkdir()
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Echo)
        cls.addClassCleanup(cls.upstream.server_close)
        cls.addClassCleanup(cls.upstream.shutdown)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            cls.port = probe.getsockname()[1]
        # Keep directives intact; replace only deployment addresses with test peers.
        config = Path(__file__).with_name('nginx.conf').read_text()
        config = config.replace('172.29.240.2', '127.0.0.2')
        config = config.replace('listen 8080;', f'listen 127.0.0.1:{cls.port};')
        for upstream in ('server:8000', 'ws:8001', 'web:3000'):
            config = config.replace(upstream, f'127.0.0.1:{cls.upstream.server_port}')
        (root / 'nginx.conf').write_text('events {}\nhttp {\n' + config + '\n}\n')
        cls.command = [str(Path(os.environ['BARK_TEST_NGINX']).resolve()), '-p', root.as_posix() + '/', '-c', 'nginx.conf']
        cls.options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        syntax = subprocess.run([*cls.command, '-t'], capture_output=True, text=True, **cls.options)
        if syntax.returncode:
            raise RuntimeError(syntax.stderr)
        cls.process = subprocess.Popen(cls.command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **cls.options)
        cls.addClassCleanup(cls.stop_nginx)
        for attempt in range(50):
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=.2):
                    return
            except OSError:
                time.sleep(.1)
        raise RuntimeError('Test nginx did not start')

    @classmethod
    def stop_nginx(cls):
        subprocess.run([*cls.command, '-s', 'quit'], check=True, capture_output=True, **cls.options)
        cls.process.wait(timeout=10)
        # A Unix master daemon may outlive the launcher briefly after graceful quit.
        for attempt in range(50):
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=.1):
                    time.sleep(.1)
            except OSError:
                return
        raise RuntimeError('Test nginx did not stop')

    def request(self, path, source='127.0.0.1', client='198.51.100.8', upgrade=False):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3, source_address=(source, 0))
        try:
            headers = {'Host': 'bark-test.duckdns.org', 'X-Forwarded-For': client,
                       'X-Real-IP': '192.0.2.99', 'X-Forwarded-Proto': 'https'}
            if upgrade:
                headers.update(Upgrade='websocket', Connection='Upgrade')
            connection.request('GET', path, headers=headers)
            response = connection.getresponse()
            body = response.read()
            return response.status, json.loads(body) if response.status == 200 else {}
        finally:
            connection.close()

    def test_direct_peer_cannot_spoof_client_or_tls(self):
        for path in ('/', '/api/example/', '/ws/'):
            status, headers = self.request(path, upgrade=path == '/ws/')
            self.assertEqual(status, 200)
            self.assertEqual(headers['host'], 'bark-test.duckdns.org')
            self.assertEqual(headers['x-forwarded-proto'], 'http')
            self.assertEqual(headers['x-forwarded-for'], '127.0.0.1')
            self.assertEqual(headers['x-real-ip'], '127.0.0.1')

    def test_caddy_peer_preserves_client_tls_and_websocket_upgrade(self):
        for path in ('/', '/api/example/', '/ws/'):
            status, headers = self.request(path, source='127.0.0.2', upgrade=path == '/ws/')
            self.assertEqual(status, 200)
            self.assertEqual(headers['host'], 'bark-test.duckdns.org')
            self.assertEqual(headers['x-forwarded-proto'], 'https')
            self.assertEqual(headers['x-forwarded-for'], '198.51.100.8')
            if path == '/ws/':
                self.assertEqual(headers['upgrade'], 'websocket')
                self.assertEqual(headers['connection'].lower(), 'upgrade')

    def test_auth_limit_is_per_client_through_caddy(self):
        statuses = [self.request('/api/auth/login/', source='127.0.0.2', client='198.51.100.20')[0] for _ in range(15)]
        self.assertIn(429, statuses)
        self.assertEqual(self.request('/api/auth/login/', source='127.0.0.2', client='198.51.100.21')[0], 200)


if __name__ == '__main__':
    unittest.main()
