"""Resource-oriented wrappers over the GitHub REST API."""

from .actions import ActionsResource
from .base import Resource
from .issues import IssuesResource
from .orgs import OrgsResource
from .pulls import PullsResource
from .repos import ReposResource
from .search import SearchResource
from .users import UsersResource

__all__ = [
    "ActionsResource",
    "IssuesResource",
    "OrgsResource",
    "PullsResource",
    "ReposResource",
    "Resource",
    "SearchResource",
    "UsersResource",
]
