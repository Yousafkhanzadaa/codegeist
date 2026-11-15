"""Template only: connect your real application in application_test.py.

Unexpected setup/application exceptions propagate as nonzero exits; they must
not become a successful reproduction of the selected assertion.
"""
import json
import sys
from application_test import check_selected_invariant

with open(sys.argv[1], encoding="utf-8") as fixture:
    payload = json.load(fixture)
passed = check_selected_invariant(payload)
if not isinstance(passed, bool):
    raise TypeError("application-check-must-return-boolean")
result = {"version": 1, "assertionId": "service.selected-invariant.v1", "outcome": "pass" if passed else "fail"}
if not passed:
    result.update(failureKind="selected-invariant-failed", failureSite="service.selected-assertion.v1")
print(json.dumps(result))
