"""Public GET transport; authenticated API requests may not redirect credentials."""

from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, build_opener


class ProtectedRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.has_header("X-api-key"):
            raise HTTPError(req.full_url, code, "authenticated redirect refused", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def urlopen(request, *, timeout):
    return build_opener(ProtectedRedirect()).open(request, timeout=timeout)
