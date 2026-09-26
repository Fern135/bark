"""Authentication routes, mounted at /api/auth/ in server/urls.py.

Browser usage (web/src/lib/api.ts already has baseURL "/api", cookies and the CSRF header):

    await api.get("/auth/csrf/");                                   // once, before any POST
    await api.post("/auth/register/", { username, email, password });
    await api.post("/auth/login/", { username, password });         // sets the JWT cookie
    await api.get("/auth/me/");                                     // the logged-in user (JWT required)
    await api.post("/auth/logout/");                                // clears it
    await api.post("/auth/forgot-password/", { email });            // emails a reset link
    await api.post("/auth/reset-password/", { token, password });   // token from that link
    await api.post("/auth/forgot-username/", { email });            // emails the username
    await api.get("/auth/demo-inbox/", { params: { email } });      // demo only: read "sent" emails

Request/response details are in each view's docstring in views.py and in API.md at the repo root.
"""
from django.urls import path

from . import views

urlpatterns = [
    path('csrf/',            views.csrf,            name='csrf'),            # GET  api/auth/csrf/
    path('login/',           views.login,           name='login'),           # POST api/auth/login/
    path('me/',              views.me,              name='me'),              # GET  api/auth/me/  (JWT required)
    path('logout/',          views.logout,          name='logout'),          # POST api/auth/logout/
    path('register/',        views.register,        name='register'),        # POST api/auth/register/
    path('forgot-password/', views.forgot_password, name='forgot_password'), # POST api/auth/forgot-password/
    path('reset-password/',  views.reset_password,  name='reset_password'),  # POST api/auth/reset-password/
    path('forgot-username/', views.forgot_username, name='forgot_username'), # POST api/auth/forgot-username/
    path('demo-inbox/',      views.demo_inbox,      name='demo_inbox'),      # GET  api/auth/demo-inbox/?email=  (DEMO_EMAIL=1 only)
]
