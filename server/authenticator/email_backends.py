"""Simulated email for demos.

With DEMO_EMAIL=1, settings.py uses DemoInboxBackend: every email Django "sends" is saved as a
DemoEmail row (and printed to the server log) instead of being delivered. The frontend reads
them from GET /api/auth/demo-inbox/?email=...
"""
import logging

from django.core.mail.backends.base import BaseEmailBackend

log = logging.getLogger(__name__)


class DemoInboxBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        from .models import DemoEmail  # imported here: backends load before apps are ready

        for message in email_messages:
            for to in message.to:
                DemoEmail.objects.create(
                    to=to.strip().lower(),
                    from_email=message.from_email,
                    subject=message.subject,
                    body=message.body,
                )
                log.info("demo email to %s: %s", to, message.subject)
        return len(email_messages)
