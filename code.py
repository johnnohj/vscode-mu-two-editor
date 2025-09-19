# Main CircuitPython file
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

print("Starting LED blink program")

while True:
    led.value = True
    print("LED ON")
    time.sleep(1)

    led.value = False
    print("LED OFF")
    time.sleep(1)