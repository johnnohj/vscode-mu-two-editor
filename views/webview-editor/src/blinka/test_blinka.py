#!/usr/bin/env python3
"""
Test script for Mu 2 Editor Blinka integration
Demonstrates that Blinka can be used with proper environment setup
"""

import os

def setup_environment():
    """Set up environment variables for Blinka"""
    print("Setting up Blinka environment for Mu 2 Editor...")
    
    # Force Blinka platform detection
    os.environ['BLINKA_FORCEBOARD'] = 'GENERIC_LINUX_PC'
    os.environ['BLINKA_FORCECHIP'] = 'GENERIC_X86'
    os.environ['MU2_EDITOR_BOARD'] = '1'
    
    print(f"BLINKA_FORCEBOARD = {os.environ['BLINKA_FORCEBOARD']}")
    print(f"BLINKA_FORCECHIP = {os.environ['BLINKA_FORCECHIP']}")

def test_blinka_import():
    """Test importing Blinka libraries"""
    print("\nTesting Blinka imports...")
    
    try:
        # Test platform detection
        from adafruit_platformdetect import Detector
        detector = Detector()
        
        print("Platform detection successful!")
        print(f"   Detected board: {detector.board.id}")
        print(f"   Detected chip: {detector.chip.id}")
        
        # Test board import
        import board
        print("board module imported successfully")
        
        # Test digitalio
        import digitalio
        print("digitalio module imported successfully")
        
        # Test busio
        import busio
        print("busio module imported successfully")
        
        return True
        
    except ImportError as e:
        print(f"Import failed: {e}")
        print("   Make sure adafruit-blinka is installed:")
        print("   pip install adafruit-blinka adafruit-platformdetect")
        return False
    except Exception as e:
        print(f"Unexpected error: {e}")
        return False

def test_basic_pin_operations():
    """Test basic pin operations (mock/simulation)"""
    print("\nTesting basic pin operations...")
    
    try:
        import board
        import digitalio
        
        # This will work with Generic Linux PC board
        print("Available pins on board:")
        pins = [attr for attr in dir(board) if not attr.startswith('_')]
        print(f"   {', '.join(pins[:10])}{'...' if len(pins) > 10 else ''}")
        
        # Test creating a pin object (this should work even on Generic Linux PC)
        if hasattr(board, 'D13'):
            pin = digitalio.DigitalInOut(board.D13)
            print("Created DigitalInOut object for D13")
            
            # Note: Setting direction may fail on Generic Linux PC since there's no actual hardware
            # but the object creation should succeed
            print("   (Actual pin control requires real CircuitPython hardware)")
        else:
            print("D13 pin not available on this board")
            
        return True
        
    except Exception as e:
        print(f"Pin operation test failed: {e}")
        return False

def main():
    print("=" * 60)
    print("Mu 2 Editor Blinka Test")
    print("=" * 60)
    
    # Setup environment
    setup_environment()
    
    # Test imports
    if test_blinka_import():
        print("\nBlinka import test PASSED!")
        
        # Test pin operations
        if test_basic_pin_operations():
            print("\nBasic pin test PASSED!")
            print("\nMu 2 Editor Blinka integration is working!")
            print("\nYou can now use CircuitPython libraries with:")
            print("   import board")
            print("   import digitalio")
            print("   import busio")
        else:
            print("\nPin operations had issues (expected on Generic Linux PC)")
            print("But Blinka import is working correctly!")
    else:
        print("\nBlinka test FAILED!")
        print("Please install required packages:")
        print("   pip install adafruit-blinka adafruit-platformdetect")

if __name__ == "__main__":
    main()