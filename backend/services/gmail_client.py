"""Thin Gmail API adapter (HTTP only).

Isolates Google REST calls so finance discovery/import can be tested
without the Gmail network. Auth is a bearer access token from the
environment until a full OAuth connection flow exists.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Any, Protocol

import httpx

logger = logging.getLogger("gmail_client")

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
DEFAULT_SEARCH_QUERY = "newer_than:90d has:attachment filename:pdf"
DEFAULT_MAX_RESULTS = 25


class GmailAuthError(Exception):
    """Missing or rejected Gmail credentials."""


class GmailApiError(Exception):
    """Upstream Gmail API failure (non-auth)."""


class GmailNotFoundError(GmailApiError):
    """Message or attachment was not found in Gmail."""


class GmailClient(Protocol):
    def list_message_refs(
        self, query: str, *, max_results: int = DEFAULT_MAX_RESULTS
    ) -> list[dict[str, str]]:
        """Return ``[{id, threadId}, ...]`` matching ``query``."""

    def get_message(self, message_id: str) -> dict[str, Any]:
        """Return a full Gmail message resource."""

    def get_attachment(self, message_id: str, attachment_id: str) -> bytes:
        """Download raw attachment bytes for a message part."""


def _token_from_env() -> str:
    token = (
        os.getenv("GMAIL_ACCESS_TOKEN", "").strip()
        or os.getenv("GOOGLE_ACCESS_TOKEN", "").strip()
    )
    if not token:
        raise GmailAuthError(
            "Gmail is not connected. Set GMAIL_ACCESS_TOKEN "
            "(OAuth connection flow is not implemented yet)."
        )
    return token


class HttpxGmailClient:
    """Gmail REST client using httpx + bearer token."""

    def __init__(
        self,
        *,
        access_token: str | None = None,
        timeout_s: float = 60.0,
    ) -> None:
        self._token = access_token if access_token is not None else _token_from_env()
        self._timeout = timeout_s

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = f"{GMAIL_API_BASE}{path}"
        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.request(
                    method, url, headers=self._headers(), **kwargs
                )
        except httpx.HTTPError as exc:
            raise GmailApiError(f"Gmail request failed: {exc}") from exc

        if response.status_code in {401, 403}:
            raise GmailAuthError(
                "Gmail authorization failed. Reconnect Gmail and try again."
            )
        if response.status_code == 404:
            raise GmailNotFoundError("Gmail resource not found.")
        if response.status_code >= 400:
            detail = response.text[:300] if response.text else response.reason_phrase
            raise GmailApiError(
                f"Gmail API error ({response.status_code}): {detail}"
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise GmailApiError("Gmail returned non-JSON response") from exc
        if not isinstance(data, dict):
            raise GmailApiError("Gmail returned unexpected payload")
        return data

    def list_message_refs(
        self, query: str, *, max_results: int = DEFAULT_MAX_RESULTS
    ) -> list[dict[str, str]]:
        data = self._request(
            "GET",
            "/users/me/messages",
            params={
                "q": query,
                "maxResults": max(1, min(int(max_results), 100)),
            },
        )
        rows = data.get("messages") or []
        out: list[dict[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("id") or "").strip()
            if not mid:
                continue
            tid = str(row.get("threadId") or "").strip() or None
            item: dict[str, str] = {"id": mid}
            if tid:
                item["threadId"] = tid
            out.append(item)
        return out

    def get_message(self, message_id: str) -> dict[str, Any]:
        mid = (message_id or "").strip()
        if not mid:
            raise GmailApiError("message_id is required")
        return self._request(
            "GET",
            f"/users/me/messages/{mid}",
            params={"format": "full"},
        )

    def get_attachment(self, message_id: str, attachment_id: str) -> bytes:
        mid = (message_id or "").strip()
        aid = (attachment_id or "").strip()
        if not mid or not aid:
            raise GmailApiError("message_id and attachment_id are required")
        data = self._request(
            "GET",
            f"/users/me/messages/{mid}/attachments/{aid}",
        )
        raw_b64 = str(data.get("data") or "").strip()
        if not raw_b64:
            raise GmailApiError("Gmail attachment payload was empty")
        # Gmail returns URL-safe base64 without padding.
        padded = raw_b64 + "=" * (-len(raw_b64) % 4)
        try:
            return base64.urlsafe_b64decode(padded)
        except Exception as exc:
            raise GmailApiError("Gmail attachment was not valid base64") from exc


def get_default_gmail_client() -> GmailClient:
    return HttpxGmailClient()
