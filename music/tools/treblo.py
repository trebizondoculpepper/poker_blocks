"""Submit Treblo v3 generations, poll until done, and download the audio.

Usage: python treblo.py <out_dir> <jobs.json>
jobs.json: [{"name": "...", "body": {...v3 request...}, "endpoint": "v3" (optional)}]
"""
import json, os, pathlib, sys, time, urllib.request

def _key() -> str:
    """TREBLO_API_KEY from the environment or the project's git-ignored .env."""
    if os.environ.get("TREBLO_API_KEY"):
        return os.environ["TREBLO_API_KEY"]
    env = pathlib.Path(__file__).resolve().parents[2] / ".env"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("TREBLO_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("Set TREBLO_API_KEY (environment or .env) to call Treblo.")

KEY = _key()
BASE = "https://api.treblo.com/v1"

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
jobs = json.loads(pathlib.Path(sys.argv[2]).read_text())
tasks = {}
for job in jobs:
    endpoint = job.get("endpoint", "v3")
    path = "/generations/v3" if endpoint == "v3" else f"/generations/v3/{endpoint}"
    tasks[job["name"]] = call("POST", path, job["body"])["task_id"]
    print("submitted", job["name"], tasks[job["name"]], flush=True)

pending = dict(tasks)
while pending:
    time.sleep(10)
    for name, tid in list(pending.items()):
        status = call("GET", f"/generations/status/{tid}")
        if status in ("SUCCESS", "FAILURE"):
            info = call("GET", f"/generations/{tid}")
            (out / f"{name}.json").write_text(json.dumps(info, indent=2))
            if status == "SUCCESS":
                url = info["song_paths"][0]
                ext = url.rsplit(".", 1)[-1]
                urllib.request.urlretrieve(url, out / f"{name}.{ext}")
                print("done", name, "->", out / f"{name}.{ext}", "| tags:", ", ".join(info.get("tags") or []), flush=True)
            else:
                print("FAILED", name, info.get("error_message"), flush=True)
            del pending[name]
print("balance:", call("GET", "/credits/balance"))
