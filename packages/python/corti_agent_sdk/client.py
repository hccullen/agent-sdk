from __future__ import annotations

import json as _json
import time
import uuid
from typing import Any, AsyncGenerator, Dict, Optional, Union

import httpx

# ── Predefined environments ──────────────────────────────────────────────────

ENVIRONMENTS: Dict[str, Dict[str, str]] = {
    "eu": {
        "agents": "https://api.eu.corti.app",
        "login": "https://auth.eu.corti.app/realms",
    },
    "us": {
        "agents": "https://api.us.corti.app",
        "login": "https://auth.us.corti.app/realms",
    },
}

EnvironmentUrls = Dict[str, str]  # {"agents": "...", "login": "..."}


# ── CortiClient ──────────────────────────────────────────────────────────────

class CortiClient:
    """
    Async HTTP client for the Corti API.

    Handles OAuth2 client-credentials auth (auto-refresh) and provides
    thin ``request()`` / ``rpc_call()`` / ``rpc_stream()`` helpers used by the
    higher-level wrappers.

    Usage::

        async with CortiClient(
            tenant_name="acme",
            environment="eu",          # or "us", or a dict with "agents"/"login" keys
            auth={"client_id": "...", "client_secret": "..."},
        ) as client:
            agent_client = AgentsClient(client)
            ...

    Parameters
    ----------
    tenant_name:
        Your Corti tenant slug.
    environment:
        ``"eu"`` or ``"us"`` for the hosted environments, or a dict with
        ``"agents"`` (base URL for agent API calls) and ``"login"``
        (Keycloak realms base URL for token exchange) keys.
    auth:
        Dict with ``client_id`` and ``client_secret`` for OAuth2
        client-credentials.
    """

    def __init__(
        self,
        tenant_name: str,
        environment: Union[str, EnvironmentUrls],
        auth: Dict[str, str],
    ) -> None:
        self.tenant_name = tenant_name

        if isinstance(environment, str):
            env = ENVIRONMENTS.get(environment)
            if env is None:
                raise ValueError(
                    f"Unknown environment {environment!r}. "
                    "Use 'eu' or 'us', or pass a dict with 'agents' and 'login' keys."
                )
            self._agents_url = env["agents"].rstrip("/")
            self._login_url: Optional[str] = env["login"].rstrip("/")
        else:
            self._agents_url = environment["agents"].rstrip("/")
            self._login_url = environment.get("login", "").rstrip("/") or None

        self._client_id = auth["client_id"]
        self._client_secret = auth["client_secret"]
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._http = httpx.AsyncClient(timeout=60.0)

    # ── Auth ──────────────────────────────────────────────────────────────────

    async def _get_token(self) -> str:
        if self._token and time.monotonic() < self._token_expiry - 30:
            return self._token

        if not self._login_url:
            raise ValueError(
                "Cannot fetch token: no login URL configured. "
                "Pass environment as a dict with an 'agents' and 'login' key, "
                "or use a predefined environment ('eu' or 'us')."
            )

        token_url = (
            f"{self._login_url}/{self.tenant_name}/protocol/openid-connect/token"
        )
        resp = await self._http.post(
            token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = time.monotonic() + float(data.get("expires_in", 3600))
        return self._token

    async def _auth_headers(self) -> Dict[str, str]:
        token = await self._get_token()
        return {
            "Authorization": f"Bearer {token}",
            "Tenant-Name": self.tenant_name,
        }

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    async def request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Any] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Make an authenticated JSON request. Returns parsed response or None."""
        url = f"{self._agents_url}/{path.lstrip('/')}"
        headers = {**await self._auth_headers(), "Content-Type": "application/json"}
        resp = await self._http.request(
            method,
            url,
            headers=headers,
            json=body,
            params=params,
        )
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    # ── JSON-RPC (A2A) ────────────────────────────────────────────────────────

    @staticmethod
    def _rpc_envelope(method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method,
            "params": params,
        }

    @staticmethod
    def _unwrap_rpc(payload: Dict[str, Any]) -> Any:
        """Return ``result`` from a JSON-RPC response or raise on malformed/error responses."""
        has_result = "result" in payload
        has_error = "error" in payload and payload["error"] is not None
        if has_result == has_error:
            raise RuntimeError(
                "Malformed JSON-RPC response: expected exactly one of 'result' or 'error'"
            )
        if has_error:
            err = payload["error"]
            code = err.get("code")
            msg = err.get("message", "JSON-RPC error")
            data = err.get("data")
            raise RuntimeError(f"A2A error {code}: {msg}" + (f" — {data}" if data else ""))
        return payload["result"]

    async def rpc_call(
        self,
        agent_id: str,
        method: str,
        params: Dict[str, Any],
        *,
        timeout_in_seconds: Optional[float] = None,
    ) -> Any:
        """
        Make a JSON-RPC 2.0 call against ``/agents/{id}/v1``.

        Returns the ``result`` field from the server's JSON-RPC response, or
        raises ``RuntimeError`` if the server returns a JSON-RPC ``error``.
        """
        url = f"{self._agents_url}/agents/{agent_id}/v1"
        headers = {**await self._auth_headers(), "Content-Type": "application/json"}
        timeout = httpx.Timeout(timeout_in_seconds) if timeout_in_seconds is not None else None
        resp = await self._http.post(url, headers=headers, json=self._rpc_envelope(method, params), timeout=timeout)
        resp.raise_for_status()
        return self._unwrap_rpc(resp.json())

    async def rpc_stream(
        self,
        agent_id: str,
        method: str,
        params: Dict[str, Any],
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Make a streaming JSON-RPC 2.0 call against ``/agents/{id}/v1``.

        Each SSE ``data:`` line carries a full JSON-RPC response; this method
        parses each one, unwraps ``result`` (raising on ``error``), and yields
        the decoded event dict. Stops on ``data: [DONE]`` or when the
        connection closes.
        """
        url = f"{self._agents_url}/agents/{agent_id}/v1"
        headers = {
            **await self._auth_headers(),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        body = self._rpc_envelope(method, params)

        async with self._http.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    decoded = _json.loads(payload)
                except _json.JSONDecodeError:
                    continue
                result = self._unwrap_rpc(decoded)
                if result is not None:
                    yield result

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "CortiClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()
