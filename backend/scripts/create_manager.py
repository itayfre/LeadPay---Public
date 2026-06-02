#!/usr/bin/env python3
"""
Seed script to create the first manager account.

Usage:
    cd backend
    python scripts/create_manager.py --email admin@example.com --name "Admin" --password "SecurePass123"
"""
import sys
import os
import argparse

# Add backend directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from dotenv import load_dotenv
load_dotenv()

from app.database import SessionLocal
from app.models.user import User, UserRole, UserStatus
from app.services.auth_service import hash_password


def create_manager(email: str, full_name: str, password: str):
    if len(password) < 8:
        print("❌ Password must be at least 8 characters")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email.lower().strip()).first()
        if existing:
            print(f"❌ User with email {email} already exists (role: {existing.role.value}, status: {existing.status.value})")
            sys.exit(1)

        user = User(
            email=email.lower().strip(),
            hashed_password=hash_password(password),
            full_name=full_name,
            role=UserRole.MANAGER,
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        print(f"✅ Manager account created successfully!")
        print(f"   Email:  {user.email}")
        print(f"   Name:   {user.full_name}")
        print(f"   Role:   {user.role.value}")
        print(f"   ID:     {user.id}")
        print(f"\n   Login: POST /api/v1/auth/login")
        print(f"          username={user.email}")
        print(f"          password=<your password>")
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create the first manager account")
    parser.add_argument("--email", required=True, help="Manager email address")
    parser.add_argument("--name", required=True, help="Manager full name")
    parser.add_argument("--password", required=True, help="Manager password (min 8 chars)")
    args = parser.parse_args()
    create_manager(args.email, args.name, args.password)
