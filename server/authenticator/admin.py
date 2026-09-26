from django.contrib import admin

from .models import DemoEmail


@admin.register(DemoEmail)
class DemoEmailAdmin(admin.ModelAdmin):
    list_display = ("to", "subject", "sent_at")
    search_fields = ("to", "subject")
    readonly_fields = ("to", "from_email", "subject", "body", "sent_at")
