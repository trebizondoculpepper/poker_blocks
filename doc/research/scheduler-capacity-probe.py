"""Capacity arithmetic probe for #545, NOT the production scheduler or a benchmark.

Run: python3 doc/research/scheduler-capacity-probe.py
Validates candidate bounds and partial-admission accounting in a small model.
Production timing, resource cleanup, TinyQueue and handler behavior need separate tests.
"""
import json

limits = dict(pending=4096, per_scope=1024, active=512, dispatch=128, depth=32)
pending = []
counts = {}


def admit(scope, depth):
    if (len(pending) >= limits['pending'] or
            counts.get(scope, 0) >= limits['per_scope'] or depth > limits['depth']):
        return False
    pending.append(scope)
    counts[scope] = counts.get(scope, 0) + 1
    return True


for scope in range(4):
    assert all(admit(scope, 1) for _ in range(1024))
assert not admit(4, 1)
assert len(pending) == sum(counts.values()) == 4096
updates = 0
while pending:
    batch, pending = pending[:128], pending[128:]
    for scope in batch:
        counts[scope] -= 1
    updates += 1
assert updates == 32 and sum(counts.values()) == 0
assert not admit(5, 33) and admit(5, 32)
pending.clear()
counts.clear()
active = {}
def start_effect(handle, started):
    if len(active) >= limits['active']:
        return False
    active[handle] = started
    return True
assert all(start_effect(handle, 0) for handle in range(512))
assert not start_effect(512, 0)
assert len(active) == 512
# The proposed finite lifetime bounds stale handles; model time is explicitly injected.
expired = [handle for handle, started in active.items() if 30000 - started >= 30000]
assert len(expired) == 512
for handle in expired:
    del active[handle]
assert not active
# A rejected child adds no pending/lease; cancelling admitted children drains references.
assert admit(6, 1)
assert not admit(6, 33)
assert counts[6] == 1
pending.clear()
counts.clear()
assert not pending and not counts
print(json.dumps(dict(limits=limits, full_backlog_dispatch_updates=updates,
                     assertions='passed', measured_scheduler_performance=False), indent=2))
