# Test library file for CircuitPython
"""
Test library for Mu 2 Editor testing
"""

def hello_world():
    """Simple test function"""
    return "Hello from test library!"

def add_numbers(a, b):
    """Add two numbers"""
    return a + b

class TestClass:
    """Test class for object-oriented features"""

    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}!"