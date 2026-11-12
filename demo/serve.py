"""Serve only this synthetic demo directory on loopback; no production data."""
from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18764)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    print(f'Offline demo only: http://127.0.0.1:{args.port}/')
    print('Synthetic data; no Liepin connection or real outreach. Ctrl+C to stop.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
