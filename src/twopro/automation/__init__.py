"""Repo automation you can run from CI or from the terminal.

Every helper takes a live :class:`~twopro.GitHub`, returns a small report object
and honours ``dry_run=True`` so workflows can preview changes before writing.
"""

from .digest import Digest, DigestReport, build_digest
from .labeler import LabelReport, label_pr, suggest_labels
from .review import Finding, ReviewReport, review_pr
from .stale import StaleItem, StaleReport, sweep_stale

__all__ = [
    "Digest",
    "DigestReport",
    "Finding",
    "LabelReport",
    "ReviewReport",
    "StaleItem",
    "StaleReport",
    "build_digest",
    "label_pr",
    "review_pr",
    "suggest_labels",
    "sweep_stale",
]
