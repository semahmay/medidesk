#!/usr/bin/env python3
"""
Test script to verify Sentry integration is working.
This script will:
1. Load the environment variables
2. Initialize Sentry with your DSN
3. Send a test error to Sentry
4. Confirm the error was sent
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_sentry_integration():
    """Test Sentry integration by sending a test error."""
    
    # Check if SENTRY_DSN is configured
    sentry_dsn = os.getenv("SENTRY_DSN", "").strip()
    if not sentry_dsn:
        print("❌ SENTRY_DSN not found in environment variables")
        print("Make sure your .env file contains the SENTRY_DSN")
        return False
    
    print(f"✅ Found SENTRY_DSN: {sentry_dsn[:50]}...")
    
    # Try to import and initialize Sentry
    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        print("✅ Sentry SDK imported successfully")
    except ImportError as e:
        print(f"❌ Failed to import sentry_sdk: {e}")
        print("Install it with: pip install sentry-sdk[flask]")
        return False
    
    # Initialize Sentry
    try:
        sentry_sdk.init(
            dsn=sentry_dsn,
            integrations=[
                FlaskIntegration(transaction_style="url"),
                SqlalchemyIntegration(),
            ],
            traces_sample_rate=0.1,
            send_default_pii=False,
            environment=os.getenv("FLASK_ENV", "test"),
            release=os.getenv("APP_VERSION", "1.0.0-test"),
        )
        print("✅ Sentry initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize Sentry: {e}")
        return False
    
    # Send a test error
    try:
        print("📤 Sending test error to Sentry...")
        
        # Add some context
        sentry_sdk.set_tag("test_type", "integration_test")
        sentry_sdk.set_context("test_info", {
            "script": "test_sentry.py",
            "purpose": "Verify Sentry integration"
        })
        
        # Capture a test exception
        try:
            raise ValueError("🧪 This is a test error from MediDesk AI - Sentry integration test")
        except ValueError as e:
            event_id = sentry_sdk.capture_exception(e)
            print(f"✅ Test error sent to Sentry with event ID: {event_id}")
            
        # Also send a test message
        message_id = sentry_sdk.capture_message("🧪 Test message from MediDesk AI - Sentry integration working!", level="info")
        print(f"✅ Test message sent to Sentry with event ID: {message_id}")
        
        # Flush to ensure events are sent
        sentry_sdk.flush(timeout=5)
        print("✅ Events flushed to Sentry")
        
        print("\n🎉 Sentry integration test completed successfully!")
        print("Check your Sentry dashboard at: https://sentry.io/")
        print("You should see the test error and message in your project.")
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to send test error: {e}")
        return False

def test_app_sentry():
    """Test Sentry integration through the app's observability module."""
    try:
        from observability import _sentry_enabled, _report_to_sentry
        
        if _sentry_enabled:
            print("✅ App Sentry integration is enabled")
            
            # Test the app's error reporting function
            try:
                raise RuntimeError("🧪 Test error via app's observability module")
            except RuntimeError as e:
                _report_to_sentry(e)
                print("✅ Test error sent via app's error reporting")
                
        else:
            print("❌ App Sentry integration is not enabled")
            return False
            
    except ImportError as e:
        print(f"❌ Could not import observability module: {e}")
        return False
    except Exception as e:
        print(f"❌ Error testing app Sentry integration: {e}")
        return False
    
    return True

if __name__ == "__main__":
    print("🧪 Testing Sentry Integration for MediDesk AI")
    print("=" * 50)
    
    # Test direct Sentry integration
    print("\n1. Testing direct Sentry integration...")
    direct_test = test_sentry_integration()
    
    # Test app's Sentry integration
    print("\n2. Testing app's Sentry integration...")
    app_test = test_app_sentry()
    
    print("\n" + "=" * 50)
    if direct_test and app_test:
        print("🎉 All Sentry tests passed!")
        print("\nNext steps:")
        print("1. Check your Sentry dashboard for the test events")
        print("2. Your application will now automatically report errors to Sentry")
        print("3. You can also trigger a test error via the API endpoint:")
        print("   POST /api/internal/sentry-test (when FLASK_ENV=test)")
        sys.exit(0)
    else:
        print("❌ Some Sentry tests failed. Check the output above.")
        sys.exit(1)