"""Public GET transport; authenticated API requests may not redirect credentials."""

from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener


class ProtectedRedirect(HTTPRedirectHandler):
    def __init__(self, allowed_hosts=None):
        self.allowed_hosts = allowed_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.has_header("X-api-key"):
            raise HTTPError(req.full_url, code, "authenticated redirect refused", headers, fp)
        if self.allowed_hosts is not None:
            target = urlsplit(newurl)
            if (target.scheme != "https" or target.hostname not in self.allowed_hosts
                    or target.username or target.password or target.port not in (None, 443)):
                raise HTTPError(req.full_url, code, "untrusted policy redirect refused", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def urlopen(request, *, timeout, allowed_hosts=None):
    return build_opener(ProtectedRedirect(allowed_hosts)).open(request, timeout=timeout)
