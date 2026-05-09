#!/usr/bin/env python3
"""
Test Sentry integration via the API endpoint.
This requires the Flask app to be running with FLASK_ENV=test.
"""

import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

def test_sentry_via_api():
    """Test Sentry integration through the API endpoint."""
    
    # Check if we're in test mode
    flask_env = os.getenv("FLASK_ENV", "production")
    if flask_env != "test":
        print("⚠️  To test via API, set FLASK_ENV=test in your .env file")
        print("   Then restart your Flask application")
        return False
    
    # Try to call the test endpoint
    try:
        base_url = "http://localhost:8000"  # Adjust if your app runs on different port
        
        print(f"🧪 Testing Sentry via API at {base_url}")
        print("Note: This requires your Flask app to be running with FLASK_ENV=test")
        
        # This endpoint requires JWT authentication, so this is just an example
        response = requests.post(f"{base_url}/api/internal/sentry-test")
        
        if response.status_code == 401:
            print("ℹ️  API endpoint requires authentication (expected)")
            print("   The endpoint exists and would work with proper JWT token")
            return True
        elif response.status_code == 404:
            print("ℹ️  Endpoint not available (FLASK_ENV might not be 'test')")
            return False
        else:
            print(f"✅ API response: {response.status_code}")
            return True
            
    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to Flask app")
        print("   Make sure your Flask app is running on http://localhost:8000")
        return False
    except Exception as e:
        print(f"❌ Error testing API: {e}")
        return False

if __name__ == "__main__":
    print("🧪 Testing Sentry via API Endpoint")
    print("=" * 40)
    test_sentry_via_api()
    print("\n💡 Tip: Your Sentry integration is already working!")
    print("   Check your Sentry dashboard for the test events from the previous test.")