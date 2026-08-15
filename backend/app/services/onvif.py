"""PTZ ONVIF tối giản: GetProfiles + ContinuousMove/Stop (SOAP, PasswordDigest)."""
from __future__ import annotations

import base64
import hashlib
import re
import secrets
from datetime import datetime, timezone

import httpx

NS_SEC = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
NS_PTZ = "http://www.onvif.org/ver20/ptz/wsdl/"

_VELOCITY = {
    "left": ('<PanTilt x="-0.5" y="0" xmlns="http://www.onvif.org/ver10/schema"/>', ""),
    "right": ('<PanTilt x="0.5" y="0" xmlns="http://www.onvif.org/ver10/schema"/>', ""),
    "up": ('<PanTilt x="0" y="0.5" xmlns="http://www.onvif.org/ver10/schema"/>', ""),
    "down": ('<PanTilt x="0" y="-0.5" xmlns="http://www.onvif.org/ver10/schema"/>', ""),
    "zoom_in": ('', '<Zoom z="0.3" xmlns="http://www.onvif.org/ver10/schema"/>'),
    "zoom_out": ('', '<Zoom z="-0.3" xmlns="http://www.onvif.org/ver10/schema"/>'),
}


def _envelope(user: str, password: str, body: str) -> str:
    nonce_raw = secrets.token_bytes(16)
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    digest = base64.b64encode(
        hashlib.sha1(nonce_raw + created.encode() + password.encode()).digest()
    ).decode()
    nonce_b64 = base64.b64encode(nonce_raw).decode()
    return f"""<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
<s:Header>
<Security s:mustUnderstand="1" xmlns="{NS_SEC}">
<UsernameToken>
<Username>{user}</Username>
<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</Password>
<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{nonce_b64}</Nonce>
<Created>{created}</Created>
</UsernameToken>
</Security>
</s:Header>
<s:Body>{body}</s:Body>
</s:Envelope>"""


async def _post(url: str, user: str, password: str, body: str) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            url,
            content=_envelope(user, password, body),
            headers={"Content-Type": 'application/soap+xml; charset=utf-8'},
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"ONVIF HTTP {resp.status_code}: {resp.text[:200]}")
    if "Fault" in resp.text:
        reason = re.search(r"<s:text[^>]*>([^<]+)", resp.text)
        raise RuntimeError(f"ONVIF Fault: {reason.group(1) if reason else 'không rõ'}")
    return resp.text


async def _first_profile_token(url: str, user: str, password: str) -> str:
    text = await _post(
        url, user, password,
        f'<GetProfiles xmlns="{NS_PTZ}"/>',
    )
    m = re.search(r'token="([^"]+)"', text)
    if not m:
        raise RuntimeError("Camera không có PTZ profile")
    return m.group(1)


async def ptz_command(
    onvif_url: str, user: str, password: str, action: str
) -> None:
    token = await _first_profile_token(onvif_url, user, password)
    if action == "stop":
        body = f'<Stop xmlns="{NS_PTZ}"><ProfileToken>{token}</ProfileToken></Stop>'
    elif action in _VELOCITY:
        pantilt, zoom = _VELOCITY[action]
        body = (
            f'<ContinuousMove xmlns="{NS_PTZ}"><ProfileToken>{token}</ProfileToken>'
            f"<Velocity>{pantilt}{zoom}</Velocity></ContinuousMove>"
        )
    else:
        raise ValueError(f"Hành động PTZ không hợp lệ: {action}")
    await _post(onvif_url, user, password, body)
    if action != "stop":
        # thả lệnh sau 800ms để camera không quay liên tục
        body_stop = f'<Stop xmlns="{NS_PTZ}"><ProfileToken>{token}</ProfileToken></Stop>'
        import asyncio

        await asyncio.sleep(0.8)
        try:
            await _post(onvif_url, user, password, body_stop)
        except Exception:
            pass
