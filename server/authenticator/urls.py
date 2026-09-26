from django.urls import path

from . import views

urlpatterns = [
    path('login/',      views.login, name='login'),       # api/auth/login/
    path('register/',   views.register, name='register'), # api/auth/register/
]
