"""Renderers for endpoints that answer with a file rather than JSON."""

import json

from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.renderers import BaseRenderer


class PDFRenderer(BaseRenderer):
    """Lets clients ask for application/pdf; errors still come back as JSON bytes."""

    media_type = "application/pdf"
    format = "pdf"
    charset = None
    render_style = "binary"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, bytes):
            return data
        return json.dumps(data).encode()


class FileRenderer(BaseRenderer):
    """
    Accepts any Accept header so a download link opened straight from the browser works.
    The view itself returns the file response; this only satisfies content negotiation.
    """

    media_type = "*/*"
    format = "file"
    charset = None
    render_style = "binary"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, bytes):
            return data
        return json.dumps(data).encode()


class DownloadNegotiation(BaseContentNegotiation):
    """
    Downloads choose their own content type, so the client's Accept header (and DRF's own
    `?format=` override, which our exports use for the file type) must not enter into it.
    """

    def select_parser(self, request, parsers):
        return parsers[0]

    def select_renderer(self, request, renderers, format_suffix=None):
        renderer = renderers[0]
        return renderer, renderer.media_type
