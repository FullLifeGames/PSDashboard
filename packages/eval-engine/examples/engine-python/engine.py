#!/usr/bin/env python3
"""A minimal engine for PS Dashboard: the engine protocol ps-dashboard-engine/1, Python standard library only.

Run:   python engine.py                (answers on http://localhost:8765/)
Check: npx @fulllifegames/eval-engine check-engine http://localhost:8765/
Use:   PS Dashboard, Evaluation panel, "+ engine", address http://localhost:8765/

`judge` is where a bot's own judgment goes. The request carries the spectator log, each side's request
JSON, the options to value, and the full simulator state; ENGINES.md in the repository describes every field.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PROTOCOL = "ps-dashboard-engine/1"
HOST, PORT = "localhost", 8765


def judge(request):
    """The position's value for p1 and each option's value for its own side, all from -1 (lost) to +1 (won).

    This example has no judgment of its own: it rates attacking a little above switching. A matrix (every
    p1 option against every p2 option, from p1's side) would let the dashboard solve the game and show reads.
    """
    values = {
        side: {option["id"]: (0.1 if option["command"].startswith("move") else 0.0) for option in request["options"][side]}
        for side in ("p1", "p2")
    }
    return 0.0, values


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        # The dashboard runs on other origins (github.io, fulllifegames.com): the browser asks first.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        # Chrome asks a public page's request to a local address for this too.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if request.get("protocol") != PROTOCOL:
            self.send_response(400)
            self.cors()
            self.end_headers()
            return
        score, values = judge(request)
        body = json.dumps({
            "protocol": PROTOCOL, "score": score, "values": values,
            "engine": {"name": "Python example", "version": "1"},
        }).encode()
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"PS Dashboard engine on http://{HOST}:{PORT}/")
    HTTPServer((HOST, PORT), Handler).serve_forever()
