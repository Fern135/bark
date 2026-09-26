from django.db import models


class User(models.Model):
    username = models.CharField(max_length=100)
    password = models.CharField(max_length=100)
    email = models.EmailField()
    user_id = models.CharField(max_length=132, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.username

class DemoEmail(models.Model):
    """An email "sent" while DEMO_EMAIL=1. Nothing leaves the server; the demo inbox
    endpoint (GET /api/auth/demo-inbox/) shows these instead."""
    to = models.EmailField(db_index=True)
    from_email = models.CharField(max_length=254)
    subject = models.CharField(max_length=255)
    body = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-sent_at"]

    def __str__(self):
        return f"{self.to}: {self.subject}"
