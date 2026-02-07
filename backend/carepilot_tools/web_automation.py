from __future__ import annotations

import ipaddress
import os
import re
import socket
import uuid
from typing import Any
from urllib.parse import urlparse

from memory.time_utils import parse_iso


class BrowserAutomationRunner:
    """Local browser automation runner inspired by OpenClaw browser tool patterns."""

    def __init__(self) -> None:
        self.enabled = os.getenv("CAREPILOT_ENABLE_BROWSER_AUTOMATION", "true").strip().lower() == "true"
        self.headless = os.getenv("CAREPILOT_BROWSER_HEADLESS", "true").strip().lower() == "true"
        self.timeout_ms = self._read_int_env("CAREPILOT_BROWSER_TIMEOUT_MS", default=25000, minimum=1000, maximum=120000)
        self.slow_mo_ms = self._read_int_env("CAREPILOT_BROWSER_SLOW_MO_MS", default=0, minimum=0, maximum=3000)
        self.max_steps = self._read_int_env("CAREPILOT_BROWSER_MAX_STEPS", default=3, minimum=1, maximum=8)

    def submit_appointment(
        self,
        *,
        booking_url: str,
        provider_name: str,
        location: str,
        slot_datetime: str,
        full_name: str,
        email: str,
        phone: str,
        extra_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._submit_form(
            target_url=booking_url,
            required_fields=("full_name", "email", "phone", "slot_datetime"),
            field_values={
                "provider_name": provider_name,
                "location": location,
                "slot_datetime": slot_datetime,
                "full_name": full_name,
                "email": email,
                "phone": phone,
            },
            extra_fields=extra_fields,
            submit_patterns=(
                r"\bbook\b",
                r"\bschedule\b",
                r"\bsubmit\b",
                r"\bconfirm\b",
                r"\brequest\b",
                r"\bnext\b",
                r"\bcontinue\b",
            ),
            success_patterns=(
                r"appointment (?:is )?confirmed",
                r"booking confirmed",
                r"request submitted",
                r"confirmation (?:number|id)",
                r"thank you",
            ),
            action_label="appointment",
        )

    def submit_purchase(
        self,
        *,
        purchase_url: str,
        item_name: str,
        quantity: int,
        full_name: str,
        email: str,
        phone: str,
        shipping_address: str | None = None,
        extra_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        fields: dict[str, str] = {
            "item_name": item_name,
            "quantity": str(max(1, quantity)),
            "full_name": full_name,
            "email": email,
            "phone": phone,
        }
        if shipping_address:
            fields["shipping_address"] = shipping_address
        return self._submit_form(
            target_url=purchase_url,
            required_fields=("item_name", "quantity", "full_name", "email", "phone"),
            field_values=fields,
            extra_fields=extra_fields,
            submit_patterns=(
                r"\bbuy\b",
                r"\bcheckout\b",
                r"\bplace order\b",
                r"\bpay\b",
                r"\bsubmit\b",
                r"\bcontinue\b",
            ),
            success_patterns=(
                r"order (?:is )?confirmed",
                r"purchase (?:is )?confirmed",
                r"order placed",
                r"payment successful",
                r"confirmation (?:number|id)",
                r"thank you",
            ),
            action_label="purchase",
        )

    def _submit_form(
        self,
        *,
        target_url: str,
        required_fields: tuple[str, ...],
        field_values: dict[str, str],
        extra_fields: dict[str, Any] | None,
        submit_patterns: tuple[str, ...],
        success_patterns: tuple[str, ...],
        action_label: str,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {
                "status": "pending",
                "message": "Browser automation is disabled by CAREPILOT_ENABLE_BROWSER_AUTOMATION.",
                "missing_fields": [],
            }

        normalized_url = self._normalize_url(target_url)
        if not normalized_url:
            return {
                "status": "pending",
                "message": "A valid booking/purchase URL is required for live browser automation.",
                "missing_fields": ["booking_url" if action_label == "appointment" else "purchase_url"],
            }

        merged_values: dict[str, str] = {
            str(key): str(value).strip()
            for key, value in field_values.items()
            if isinstance(key, str) and value is not None and str(value).strip()
        }
        if isinstance(extra_fields, dict):
            for key, value in extra_fields.items():
                if not isinstance(key, str):
                    continue
                text_value = str(value).strip()
                if text_value:
                    merged_values[key] = text_value

        missing = [name for name in required_fields if not str(merged_values.get(name) or "").strip()]
        if missing:
            return {
                "status": "pending",
                "message": "Missing required user details for live web form completion.",
                "missing_fields": missing,
            }

        try:
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except Exception:
            return {
                "status": "pending",
                "message": (
                    "Playwright is not available. Install browser automation dependencies "
                    "and run `playwright install chromium`."
                ),
                "missing_fields": [],
            }

        browser = None
        page = None
        start_url = normalized_url
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=self.headless, slow_mo=self.slow_mo_ms)
                context = browser.new_context()
                page = context.new_page()
                page.set_default_timeout(self.timeout_ms)
                page.set_default_navigation_timeout(self.timeout_ms)
                self._arm_dialog_handler(page)
                page.goto(normalized_url, wait_until="domcontentloaded", timeout=self.timeout_ms)
                start_url = page.url

                for step in range(self.max_steps):
                    self._dismiss_common_overlays(page)
                    blocker = self._detect_submission_blocker(page)
                    if blocker:
                        return {
                            "status": "pending",
                            "message": blocker,
                            "missing_fields": [],
                            "automation": {"current_url": page.url, "title": page.title(), "step": step + 1},
                        }

                    field_errors = self._apply_field_values(page, merged_values)
                    required_missing = self._detect_required_missing_fields(page, merged_values)
                    all_missing = sorted(set(field_errors + required_missing))
                    if all_missing:
                        return {
                            "status": "pending",
                            "message": "More user details are needed to complete this web form.",
                            "missing_fields": all_missing,
                            "automation": {"current_url": page.url, "title": page.title(), "step": step + 1},
                        }

                    submitted = self._click_submit(page, submit_patterns)
                    if not submitted:
                        followed_link = self._follow_action_link(page, submit_patterns)
                        if followed_link:
                            self._wait_after_submit(page)
                            start_url = page.url
                            continue
                        return {
                            "status": "pending",
                            "message": (
                                "I could not confidently find a submit/confirm control. "
                                "Please provide the exact booking/purchase page or form guidance."
                            ),
                            "missing_fields": [],
                            "automation": {"current_url": page.url, "title": page.title(), "step": step + 1},
                        }

                    self._wait_after_submit(page)
                    confirmation_hint = self._extract_confirmation_hint(page, success_patterns)
                    current_url = page.url
                    url_changed = current_url != start_url
                    has_form_controls = self._has_actionable_controls(page)
                    if confirmation_hint or (url_changed and not has_form_controls):
                        external_ref = f"WEB-{uuid.uuid4().hex[:10].upper()}"
                        return {
                            "status": "succeeded",
                            "message": f"Live {action_label} submitted.",
                            "external_ref": external_ref,
                            "automation": {
                                "current_url": current_url,
                                "title": page.title(),
                                "confirmation_hint": confirmation_hint,
                                "step": step + 1,
                            },
                        }

                    start_url = current_url
                    if step < self.max_steps - 1 and has_form_controls:
                        continue

                    return {
                        "status": "pending",
                        "message": (
                            "Submission was attempted, but confirmation is unclear "
                            "(possible CAPTCHA/login/manual review)."
                        ),
                        "missing_fields": [],
                        "automation": {"current_url": current_url, "title": page.title(), "step": step + 1},
                    }

                return {
                    "status": "pending",
                    "message": "Automation reached the max navigation steps without clear confirmation.",
                    "missing_fields": [],
                    "automation": {"current_url": page.url, "title": page.title(), "step": self.max_steps},
                }
        except PlaywrightTimeoutError as exc:
            return {
                "status": "failed",
                "message": f"Browser automation timed out: {exc}",
                "missing_fields": [],
            }
        except Exception as exc:
            return {
                "status": "failed",
                "message": f"Browser automation error: {exc}",
                "missing_fields": [],
            }
        finally:
            try:
                if page is not None:
                    page.close()
            except Exception:
                pass
            try:
                if browser is not None:
                    browser.close()
            except Exception:
                pass

    @staticmethod
    def _read_int_env(name: str, *, default: int, minimum: int, maximum: int) -> int:
        raw = (os.getenv(name, str(default)) or "").strip()
        try:
            value = int(raw)
        except Exception:
            value = default
        return max(minimum, min(value, maximum))

    @staticmethod
    def _arm_dialog_handler(page: Any) -> None:
        try:
            page.on("dialog", lambda dialog: dialog.dismiss())
        except Exception:
            pass

    @staticmethod
    def _normalize_url(raw_url: str) -> str | None:
        value = str(raw_url or "").strip()
        if not value:
            return None
        if not value.startswith("http://") and not value.startswith("https://"):
            return None
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"}:
            return None
        allow_insecure_http = os.getenv("CAREPILOT_ALLOW_INSECURE_HTTP", "false").strip().lower() == "true"
        if parsed.scheme == "http" and not allow_insecure_http:
            return None
        host = (parsed.hostname or "").strip().lower()
        if not host:
            return None
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
            return None

        def _blocked_ip(ip: Any) -> bool:
            return bool(
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            )

        try:
            parsed_ip = ipaddress.ip_address(host)
            if _blocked_ip(parsed_ip):
                return None
        except ValueError:
            try:
                resolved = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
            except socket.gaierror:
                allow_unresolved = os.getenv("CAREPILOT_BROWSER_ALLOW_UNRESOLVED_HOSTS", "false").strip().lower() == "true"
                if allow_unresolved and "." in host:
                    return value
                return None
            for entry in resolved:
                try:
                    resolved_ip = ipaddress.ip_address(entry[4][0])
                except Exception:
                    continue
                if _blocked_ip(resolved_ip):
                    return None
        return value

    @staticmethod
    def _canonical_field_for_control(meta: dict[str, str]) -> str | None:
        autocomplete = (meta.get("autocomplete") or "").strip().lower()
        control_type = (meta.get("type") or "").strip().lower()
        blob = " ".join(
            [
                meta.get("name") or "",
                meta.get("id") or "",
                meta.get("label") or "",
                meta.get("placeholder") or "",
                meta.get("aria_label") or "",
            ]
        ).lower()

        if autocomplete in {"name", "given-name", "family-name"}:
            return "full_name"
        if autocomplete in {"email"} or control_type == "email" or "email" in blob:
            return "email"
        if autocomplete in {"tel", "phone"} or control_type == "tel" or "phone" in blob or "mobile" in blob:
            return "phone"
        if autocomplete.startswith("address"):
            return "shipping_address"
        if control_type == "date":
            return "slot_date"
        if control_type == "time":
            return "slot_time"
        if control_type == "datetime-local":
            return "slot_datetime"

        if any(token in blob for token in ("full name", "patient name", "first name", "last name")):
            return "full_name"
        if any(token in blob for token in ("appointment", "schedule", "datetime", "date and time")):
            return "slot_datetime"
        if any(token in blob for token in ("quantity", "qty", "amount")):
            return "quantity"
        if any(token in blob for token in ("item", "product", "test kit", "kit")):
            return "item_name"
        if any(token in blob for token in ("provider", "doctor", "clinic")):
            return "provider_name"
        if any(token in blob for token in ("location", "city")):
            return "location"
        if any(token in blob for token in ("address", "street")):
            return "shipping_address"
        return None

    def _apply_field_values(self, page: Any, field_values: dict[str, str]) -> list[str]:
        missing: list[str] = []
        slot_date, slot_time = self._slot_parts(field_values.get("slot_datetime", ""))
        slot_component_filled = False

        # Ordered so explicit details land before submit.
        plan: list[tuple[str, str]] = [
            ("full_name", field_values.get("full_name", "")),
            ("email", field_values.get("email", "")),
            ("phone", field_values.get("phone", "")),
            ("shipping_address", field_values.get("shipping_address", "")),
            ("provider_name", field_values.get("provider_name", "")),
            ("location", field_values.get("location", "")),
            ("item_name", field_values.get("item_name", "")),
            ("quantity", field_values.get("quantity", "")),
            ("slot_date", slot_date),
            ("slot_time", slot_time),
            ("slot_datetime", field_values.get("slot_datetime", "")),
        ]
        for field, value in field_values.items():
            if field in {
                "full_name",
                "email",
                "phone",
                "shipping_address",
                "provider_name",
                "location",
                "item_name",
                "quantity",
                "slot_date",
                "slot_time",
                "slot_datetime",
            }:
                continue
            plan.append((field, value))

        for field, value in plan:
            value = str(value or "").strip()
            if not value:
                continue
            filled = self._fill_field(page, field, value)
            if field in {"slot_date", "slot_time"} and filled:
                slot_component_filled = True
            if not filled:
                # Hard requirements only.
                if field in {"full_name", "email", "phone", "item_name", "quantity", "slot_datetime"}:
                    if field == "slot_datetime" and slot_component_filled:
                        continue
                    missing.append(field)
        return sorted(set(missing))

    def _fill_field(self, page: Any, field: str, value: str) -> bool:
        selector_map = {
            "full_name": (
                'input[autocomplete="name" i]',
                'input[name*="name" i], input[id*="name" i]',
            ),
            "email": (
                'input[type="email"]',
                'input[autocomplete="email" i]',
                'input[name*="email" i], input[id*="email" i]',
            ),
            "phone": (
                'input[type="tel"]',
                'input[autocomplete="tel" i]',
                'input[name*="phone" i], input[id*="phone" i], input[name*="mobile" i]',
            ),
            "shipping_address": (
                'input[autocomplete*="address" i]',
                'input[name*="address" i], textarea[name*="address" i], input[id*="address" i]',
            ),
            "quantity": (
                'input[type="number"]',
                'input[name*="quantity" i], input[name*="qty" i], select[name*="quantity" i]',
            ),
            "slot_date": (
                'input[type="date"]',
                'input[name*="date" i], input[id*="date" i]',
            ),
            "slot_time": (
                'input[type="time"]',
                'input[name*="time" i], input[id*="time" i]',
            ),
            "slot_datetime": (
                'input[type="datetime-local"]',
                'input[name*="datetime" i], input[name*="appointment" i], input[id*="datetime" i]',
            ),
        }
        keyword_map = {
            "full_name": ("full name", "name", "patient"),
            "email": ("email", "e-mail"),
            "phone": ("phone", "mobile", "tel"),
            "shipping_address": ("address", "street"),
            "provider_name": ("provider", "doctor", "clinic"),
            "location": ("location", "city"),
            "item_name": ("item", "product", "test", "kit"),
            "quantity": ("quantity", "qty", "amount"),
            "slot_date": ("date", "day"),
            "slot_time": ("time", "hour"),
            "slot_datetime": ("appointment", "datetime", "date", "time"),
        }

        for surface in self._field_surfaces(page):
            for selector in selector_map.get(field, ()):
                try:
                    control = surface.locator(selector).first
                    if control.count() > 0 and self._fill_locator(control, value):
                        return True
                except Exception:
                    pass

            keywords = keyword_map.get(field, (field.replace("_", " "),))
            for keyword in keywords:
                try:
                    labeled = surface.get_by_label(re.compile(keyword, re.IGNORECASE)).first
                    if labeled.count() > 0 and self._fill_locator(labeled, value):
                        return True
                except Exception:
                    pass

                try:
                    by_placeholder = surface.get_by_placeholder(re.compile(keyword, re.IGNORECASE)).first
                    if by_placeholder.count() > 0 and self._fill_locator(by_placeholder, value):
                        return True
                except Exception:
                    pass

                safe_keyword = keyword.replace('"', '\\"')
                selector = (
                    f'input[name*="{safe_keyword}" i], input[id*="{safe_keyword}" i], '
                    f'input[aria-label*="{safe_keyword}" i], input[autocomplete*="{safe_keyword}" i], '
                    f'textarea[name*="{safe_keyword}" i], textarea[id*="{safe_keyword}" i], '
                    f'textarea[aria-label*="{safe_keyword}" i], '
                    f'select[name*="{safe_keyword}" i], select[id*="{safe_keyword}" i], '
                    f'[data-testid*="{safe_keyword}" i]'
                )
                try:
                    control = surface.locator(selector).first
                    if control.count() > 0 and self._fill_locator(control, value):
                        return True
                except Exception:
                    pass
        return False

    def _click_submit(self, page: Any, patterns: tuple[str, ...]) -> bool:
        negative_terms = ("search", "newsletter", "subscribe")
        for pattern in patterns:
            try:
                button = page.get_by_role("button", name=re.compile(pattern, re.IGNORECASE)).first
                if button.count() > 0:
                    button_name = str(button.inner_text() or "").strip().lower()
                    if button_name and any(term in button_name for term in negative_terms):
                        continue
                    if button.is_disabled():
                        continue
                    button.click(timeout=self.timeout_ms)
                    return True
            except Exception:
                pass

        try:
            submit = page.locator('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled])').first
            if submit.count() > 0:
                submit.click(timeout=self.timeout_ms)
                return True
        except Exception:
            pass
        return False

    def _follow_action_link(self, page: Any, patterns: tuple[str, ...]) -> bool:
        for pattern in patterns:
            try:
                link = page.get_by_role("link", name=re.compile(pattern, re.IGNORECASE)).first
                if link.count() == 0:
                    continue
                href = str(link.get_attribute("href") or "").strip()
                if not href:
                    continue
                link.click(timeout=self.timeout_ms)
                return True
            except Exception:
                pass
        return False

    def _wait_after_submit(self, page: Any) -> None:
        try:
            page.wait_for_load_state("networkidle", timeout=min(self.timeout_ms, 8000))
        except Exception:
            try:
                page.wait_for_timeout(1200)
            except Exception:
                pass

    def _dismiss_common_overlays(self, page: Any) -> None:
        patterns = (
            r"\baccept\b",
            r"\bi agree\b",
            r"\bok\b",
            r"\bcontinue\b",
            r"\bclose\b",
            r"\bgot it\b",
        )
        overlay_selectors = [
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[id*="cookie" i], [class*="cookie" i]',
            '[id*="consent" i], [class*="consent" i]',
        ]
        for container_selector in overlay_selectors:
            try:
                container = page.locator(container_selector).first
                if container.count() == 0 or not container.is_visible():
                    continue
            except Exception:
                continue
            for pattern in patterns:
                try:
                    button = container.get_by_role("button", name=re.compile(pattern, re.IGNORECASE)).first
                    if button.count() > 0 and button.is_visible():
                        button.click(timeout=1200)
                        return
                except Exception:
                    continue

    def _detect_submission_blocker(self, page: Any) -> str | None:
        try:
            if page.locator('iframe[src*="recaptcha" i], iframe[title*="captcha" i]').count() > 0:
                return "CAPTCHA was detected. Manual user interaction is required to continue."
        except Exception:
            pass

        try:
            if page.locator('input[type="password"]').count() > 0:
                body = (page.inner_text("body") or "").lower()
                if "login" in body or "sign in" in body:
                    return "This flow requires login before submission. Please authenticate first, then retry."
        except Exception:
            pass

        return None

    def _field_surfaces(self, page: Any) -> list[Any]:
        surfaces: list[Any] = [page]
        try:
            for frame in page.frames:
                if frame is not None and frame not in surfaces:
                    surfaces.append(frame)
        except Exception:
            pass
        return surfaces

    def _fill_locator(self, control: Any, value: str) -> bool:
        try:
            tag_name = (control.evaluate("el => (el.tagName || '').toLowerCase()") or "").lower()
            input_type = (control.evaluate("el => (el.type || '').toLowerCase()") or "").lower()
        except Exception:
            tag_name = ""
            input_type = ""

        try:
            if tag_name == "select":
                try:
                    control.select_option(label=value)
                except Exception:
                    control.select_option(value=value)
                return True
            if input_type in {"checkbox", "radio"}:
                truthy = value.strip().lower() in {"1", "true", "yes", "on", "checked"}
                if input_type == "radio":
                    if truthy:
                        control.check()
                        return True
                    return False
                if truthy:
                    control.check()
                else:
                    control.uncheck()
                return True
            control.fill(value)
            return True
        except Exception:
            return False

    def _has_actionable_controls(self, page: Any) -> bool:
        selectors = [
            'input[required], textarea[required], select[required]',
            'input[type="date"], input[type="time"], input[type="datetime-local"]',
            'input[type="email"], input[type="tel"], input[type="number"]',
        ]
        for selector in selectors:
            try:
                if page.locator(selector).count() > 0:
                    return True
            except Exception:
                continue
        return False

    def _detect_required_missing_fields(self, page: Any, field_values: dict[str, str]) -> list[str]:
        missing: set[str] = set()
        selector = (
            'input[required], input[aria-required="true"], '
            'textarea[required], textarea[aria-required="true"], '
            'select[required], select[aria-required="true"]'
        )
        for surface in self._field_surfaces(page):
            try:
                controls = surface.locator(selector)
                count = min(controls.count(), 40)
            except Exception:
                continue
            for idx in range(count):
                try:
                    meta = controls.nth(idx).evaluate(
                        """(el) => {
                            const label = el.labels && el.labels.length ? el.labels[0].innerText : '';
                            return {
                                name: el.getAttribute('name') || '',
                                id: el.getAttribute('id') || '',
                                type: el.getAttribute('type') || '',
                                placeholder: el.getAttribute('placeholder') || '',
                                aria_label: el.getAttribute('aria-label') || '',
                                autocomplete: el.getAttribute('autocomplete') || '',
                                label: label || '',
                                value: (el.value || '').toString(),
                                visible: !!(el.offsetParent || el.getClientRects().length),
                                disabled: !!el.disabled,
                            };
                        }"""
                    )
                except Exception:
                    continue
                if not isinstance(meta, dict):
                    continue
                if meta.get("disabled") or not meta.get("visible"):
                    continue
                canonical = self._canonical_field_for_control(
                    {
                        "name": str(meta.get("name") or ""),
                        "id": str(meta.get("id") or ""),
                        "type": str(meta.get("type") or ""),
                        "placeholder": str(meta.get("placeholder") or ""),
                        "aria_label": str(meta.get("aria_label") or ""),
                        "autocomplete": str(meta.get("autocomplete") or ""),
                        "label": str(meta.get("label") or ""),
                    }
                )
                if not canonical:
                    continue
                current_value = str(meta.get("value") or "").strip()
                if canonical in {"slot_date", "slot_time"} and str(field_values.get("slot_datetime") or "").strip():
                    continue
                if not current_value:
                    missing.add(canonical)
        if "slot_date" in missing and "slot_datetime" not in missing:
            missing.add("slot_datetime")
        if "slot_time" in missing and "slot_datetime" not in missing:
            missing.add("slot_datetime")
        missing.discard("slot_date")
        missing.discard("slot_time")
        return sorted(missing)

    def _extract_confirmation_hint(self, page: Any, patterns: tuple[str, ...]) -> str | None:
        try:
            body_text = page.inner_text("body")
        except Exception:
            return None
        normalized = re.sub(r"\s+", " ", body_text or "").strip()
        if not normalized:
            return None
        lowered = normalized.lower()
        for pattern in patterns:
            if re.search(pattern, lowered, flags=re.IGNORECASE):
                return normalized[:320]
        return None

    @staticmethod
    def _slot_parts(slot_iso: str) -> tuple[str, str]:
        dt = parse_iso(slot_iso)
        if not dt:
            return "", ""
        local = dt.astimezone()
        return local.strftime("%Y-%m-%d"), local.strftime("%H:%M")
