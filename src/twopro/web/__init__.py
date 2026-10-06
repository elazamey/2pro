"""The 2pro dashboard: a FastAPI app plus a zero-build web UI.

from twopro.web import create_app
# or: 2pro serve --port 8000
"""

from .app import create_app

__all__ = ["create_app"]
