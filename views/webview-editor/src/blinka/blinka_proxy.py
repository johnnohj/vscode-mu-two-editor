#!/usr/bin/env python3
"""
Blinka Proxy Script for Mu 2 Editor
Sets up the environment to make adafruit_blinka recognize Mu 2 as a Generic Linux PC
"""

import os
import sys

def setup_blinka_environment():
    """Set up environment variables for Blinka platform detection"""
    # Force Blinka to recognize this as a Generic Linux PC
    os.environ['BLINKA_FORCEBOARD'] = 'GENERIC_LINUX_PC'
    os.environ['BLINKA_FORCECHIP'] = 'GENERIC_X86'
    
    # Mu 2 Editor identification markers
    os.environ['MU2_EDITOR_BOARD'] = '1'
    os.environ['BLINKA_MU2_VIRTUAL'] = '1'
    
    # Optional: Set debug mode for troubleshooting
    # os.environ['BLINKA_DEBUG'] = '1'
    
    print("Mu 2 Editor Blinka Environment Setup:")
    print(f"  BLINKA_FORCEBOARD = {os.environ.get('BLINKA_FORCEBOARD')}")
    print(f"  BLINKA_FORCECHIP = {os.environ.get('BLINKA_FORCECHIP')}")
    print(f"  MU2_EDITOR_BOARD = {os.environ.get('MU2_EDITOR_BOARD')}")

def test_blinka_import():
    """Test importing Blinka libraries to verify platform detection"""
    try:
        print("\nTesting Blinka imports...")
        
        # Import platform detection first
        from adafruit_platformdetect import Detector
        detector = Detector()
        
        print(f"Detected board: {detector.board.id}")
        print(f"Detected chip: {detector.chip.id}")
        
        # Test basic board import
        import board
        print("✓ board module imported successfully")
        
        # Test digitalio import
        import digitalio
        print("✓ digitalio module imported successfully")
        
        # Test busio import for I2C/SPI
        import busio
        print("✓ busio module imported successfully")
        
        print("\n✅ Blinka import test successful!")
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def create_mock_board():
    """Create a mock board object compatible with CircuitPython"""
    import board
    
    # Create mock pin objects if they don't exist
    class MockPin:
        def __init__(self, pin_id):
            self.id = pin_id
            
        def __repr__(self):
            return f"Pin(ID={self.id})"
    
    # Add common pins if they don't exist
    common_pins = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 
                   'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'LED', 'SDA', 'SCL']
    
    for i, pin_name in enumerate(common_pins):
        if not hasattr(board, pin_name):
            if pin_name == 'LED':
                setattr(board, pin_name, getattr(board, 'D13', MockPin(13)))
            elif pin_name == 'SDA':
                setattr(board, pin_name, getattr(board, 'D2', MockPin(2)))
            elif pin_name == 'SCL':
                setattr(board, pin_name, getattr(board, 'D3', MockPin(3)))
            elif pin_name.startswith('D'):
                pin_num = int(pin_name[1:])
                setattr(board, pin_name, MockPin(pin_num))
    
    return board

def run_interactive_repl():
    """Start an interactive Python REPL with Blinka pre-configured"""
    print("\n🚀 Starting Mu 2 Editor Blinka REPL...")
    print("CircuitPython libraries are now available!")
    print("\nExample usage:")
    print("  import board")
    print("  import digitalio")
    print("  led = digitalio.DigitalInOut(board.LED)")
    print("  led.direction = digitalio.Direction.OUTPUT")
    print("  led.value = True")
    print("\nType 'exit()' to quit.")
    
    # Import common modules to global namespace
    globals_dict = globals()
    try:
        exec("import board", globals_dict)
        exec("import digitalio", globals_dict)
        exec("import busio", globals_dict)
        exec("import time", globals_dict)
        
        # Create enhanced board with all pins
        board_module = create_mock_board()
        globals_dict['board'] = board_module
        
        print(f"\nBoard detected: {getattr(board_module, 'board_id', 'Generic Linux PC')}")
        print(f"Available pins: {[attr for attr in dir(board_module) if not attr.startswith('_')]}")
        
    except Exception as e:
        print(f"Warning: Some modules may not be available: {e}")
    
    # Start interactive session
    import code
    console = code.InteractiveConsole(locals=globals_dict)
    console.interact()

def main():
    """Main entry point for the Blinka proxy"""
    print("=" * 60)
    print("🔧 Mu 2 Editor Blinka Proxy")
    print("=" * 60)
    
    # Set up environment
    setup_blinka_environment()
    
    # Test imports
    if test_blinka_import():
        print("\n✅ Blinka environment ready!")
        
        # Check command line arguments
        if len(sys.argv) > 1:
            if sys.argv[1] == '--interactive' or sys.argv[1] == '-i':
                run_interactive_repl()
            elif sys.argv[1] == '--test' or sys.argv[1] == '-t':
                print("\n🧪 Running additional tests...")
                # Add more comprehensive tests here
                pass
            else:
                # Execute the provided script
                script_path = sys.argv[1]
                if os.path.exists(script_path):
                    exec(open(script_path).read())
                else:
                    print(f"❌ Script not found: {script_path}")
        else:
            run_interactive_repl()
    else:
        print("\n❌ Blinka setup failed. Please check your installation:")
        print("   pip install adafruit-blinka adafruit-platformdetect")
        sys.exit(1)

if __name__ == "__main__":
    main()