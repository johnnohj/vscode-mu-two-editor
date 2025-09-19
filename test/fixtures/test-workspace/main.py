# Alternative main file for CircuitPython
print("Hello from Mu 2 Editor!")

import board
import neopixel

# Setup NeoPixel
pixel = neopixel.NeoPixel(board.NEOPIXEL, 1)

# Cycle through colors
colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
for color in colors:
    pixel[0] = color
    time.sleep(1)