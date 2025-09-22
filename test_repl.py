# Test Python file for Connected REPL functionality
import time

def main():
    """Simple CircuitPython-style code for testing"""
    counter = 0
    while True:
        print(f"Counter: {counter}")
        counter += 1
        time.sleep(1)

        if counter > 10:
            break

if __name__ == "__main__":
    main()