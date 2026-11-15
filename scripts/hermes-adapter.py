#!/usr/bin/env python3
"""Offline adapter for the pinned Hermes PR40763 public registry regression.
Run with python3 -I -S adapter.py VENDORED_REVISION_DIRECTORY fixture.json.
Only coerce_tool_args is called. The probe handler and network tools are not run.
"""
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
if len(sys.argv) != 3:
    raise SystemExit('Usage: python3 -I -S adapter.py REVISION_DIRECTORY fixture.json')
revision_dir = Path(sys.argv[1]).resolve()
fixture_path = Path(sys.argv[2]).resolve()
allowed_tool_files = {'__init__.py', 'registry.py'}
if {path.name for path in (revision_dir / 'tools').glob('*.py')} != allowed_tool_files:
    raise SystemExit('The isolated tool directory must contain only pinned registry.py and __init__.py.')
raw = fixture_path.read_bytes()
if len(raw) > 65536:
    raise SystemExit('Fixture exceeds 64 KiB.')

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result or key in {'__proto__', 'prototype', 'constructor'}:
            raise ValueError('Duplicate or prototype-related fixture key.')
        result[key] = value
    return result

fixture = json.loads(raw, object_pairs_hook=unique_object)
if not isinstance(fixture, dict) or set(fixture) != {'calls'}:
    raise SystemExit('Expected only a calls array.')
calls = fixture['calls']
if not isinstance(calls, list) or not 2 <= len(calls) <= 32:
    raise SystemExit('Expected 2 to 32 calls.')
values = []
for call in calls:
    if not isinstance(call, dict) or set(call) != {'chat_id'}:
        raise SystemExit('Each call must contain only chat_id.')
    value = call['chat_id']
    if not isinstance(value, str) or re.fullmatch(r'[1-9][0-9]{15,18}', value) is None or int(value) > 2**63 - 1:
        raise SystemExit('chat_id must be a canonical 16–19 digit positive signed-64-bit decimal string.')
    values.append(value)

sys.path.insert(0, str(revision_dir))
import model_tools
from tools.registry import registry

name = '_precision_probe_tool'
schema = {
    'name': name,
    'description': 'test-only probe',
    'parameters': {'type': 'object', 'properties': {'chat_id': {'type': 'integer'}}},
}
# This registration/schema pattern is the upstream PR's own integration test.
registry.register(name=name, toolset='_test', schema=schema, handler=lambda args, **kw: '{}')
if registry.get_all_tool_names() != [name]:
    raise SystemExit('Unexpected tool discovery.')
try:
    outputs = [model_tools.coerce_tool_args(name, {'chat_id': value})['chat_id'] for value in values]
finally:
    registry.deregister(name)
exact = all(type(actual) is int and actual == int(value) for value, actual in zip(values, outputs))
# Never print original or synthetic IDs: only the bounded observable result.
print(json.dumps({
    'entrypoint': 'model_tools.coerce_tool_args',
    'assertion': 'each registered integer tool argument equals its exact input integer',
    'expectedDistinct': len(set(values)),
    'observedDistinct': len(set(outputs)),
    'exactIntegerArguments': exact,
    'passed': exact,
    'toolHandlerExecuted': False,
}, sort_keys=True))
raise SystemExit(0 if exact else 1)
