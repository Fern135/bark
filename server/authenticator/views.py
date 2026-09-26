# from django.shortcuts import render
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.shortcuts import JsonResponse
from django.contrib.auth.hashers import make_password, check_password
import json
import uuid

from .models import User

async def login(request):
    ...
    # data = json.loads(request.body)
    # username = data["username"]
    # password = data["password"]

    # return render(request, "authenticator/login.html")

async def register(request):
    """
    username = models.CharField(max_length=100)
    password = models.CharField(max_length=100)
    email = models.EmailField()
    """

    if request.method == "POST":
        data = json.loads(request.body)

        user_name = data["username"]
        password  = data['password']
        email     = data['email'].strip().lower()   
        
        # Validate required fields
        if not user_name or not password or not email:
            return JsonResponse({"error": "Missing required fields"}, status=400)

        # check if email already exists (case insensitive)
        if await User.objects.filter(email__iexact=email).aexists():
            return JsonResponse({"error": "Email already registered"}, status=400)
    
        # Validate email format
        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({"error": "Invalid email format"}, status=400)
        
        # Check if user already exists
        if await User.objects.filter(username=user_name).aexists():
            return JsonResponse({"error": "User already exists"}, status=400)

        # Create new user
        user = await User.objects.acreate(
            id=str(uuid.uuid4()),  # random id used for collaboration 
            username=user_name, 
            password=make_password(password), 
            email=email
        )  

        # if there's a problem
        if not user:
            return JsonResponse({"error": "Failed to create user"}, status=500)

        # Return success response
        return JsonResponse({"message": "User created successfully"}, status=201)

    else:
        return JsonResponse({"message" : "method not allowed"}, status=405)