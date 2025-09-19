# Test CircuitPython code file
import board
import time
import digitalio

# Set up LED
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

# Blink LED
while True:
    led.value = True
    time.sleep(0.5)
    led.value = False
    time.sleep(0.5)