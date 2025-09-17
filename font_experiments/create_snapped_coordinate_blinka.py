#!/usr/bin/env python3
"""
Create coordinate-snapped Blinka font
Try snapping coordinates to font unit boundaries to fix alignment
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_snapped_coordinate_blinka():
    """Create color Blinka with coordinates snapped to font unit boundaries"""

    print("Creating coordinate-snapped Blinka font...")
    print("Snapping all coordinates to integer font unit boundaries")

    bmp_path = "assets/blinka.bmp"
    if not os.path.exists(bmp_path):
        print(f"BMP file not found: {bmp_path}")
        return False

    # Load and analyze the BMP
    img = Image.open(bmp_path)
    img = img.convert('RGBA')
    original_width, original_height = img.size

    print(f"Original BMP: {original_width}x{original_height}")

    # Get background color (black)
    bg_color = img.getpixel((0, 0))[:3]

    # Define our three specific colors
    white_rgb = (255, 255, 255)
    light_blue_rgb = (166, 202, 240)

    # Separate pixels by color
    white_pixels = []
    light_blue_pixels = []
    purple_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:
                continue
            elif rgb == white_rgb:
                white_pixels.append((x, y))
            elif rgb == light_blue_rgb:
                light_blue_pixels.append((x, y))
            else:
                purple_pixels.append((x, y))

    print(f"White: {len(white_pixels)}, Blue: {len(light_blue_pixels)}, Purple: {len(purple_pixels)}")

    # DIFFERENT COORDINATE APPROACH - try various snapping strategies
    scale_factor = 4

    # Test different base offsets to see if one eliminates the "off by 3" issue
    test_offsets = [50, 62, 38, 44, 56, 68]  # 50±12, 50±6, 50±18

    for base_offset in test_offsets:
        print(f"\nTesting base_offset = {base_offset}:")

        # Check where first few pixels would be positioned
        for i, (x, y) in enumerate(light_blue_pixels[:3]):
            flipped_y = (original_height - 1 - y)
            left = x * scale_factor + base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100
            top = bottom + scale_factor

            print(f"  Blue pixel {i}: BMP({x},{y}) -> Font({left},{bottom}) to ({right},{top})")

    # Use the offset that might fix the "3 spots early" issue
    # If we're consistently 12 units early, try +12 correction
    corrected_offset = 50 + 12
    print(f"\nUsing corrected offset: {corrected_offset}")

    # Create font with corrected coordinates
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple", "blinka.lightblue", "blinka.white"]
    fb.setupGlyphOrder(glyph_order)

    def create_snapped_layer_glyph(pixel_positions, layer_name):
        """Create layer with snapped coordinates"""
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()

        for x, y in pixel_positions:
            # Coordinate calculation with corrected offset
            flipped_y = (original_height - 1 - y)

            # SNAP to integer boundaries
            left = int(x * scale_factor + corrected_offset)
            right = int(left + scale_factor)
            bottom = int(flipped_y * scale_factor + 100)
            top = int(bottom + scale_factor)

            # Add rectangle
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_empty_base():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_space_glyph():
        pen = TTGlyphPen(None)
        return pen.glyph()

    def create_notdef_glyph():
        pen = TTGlyphPen(None)
        pen.moveTo((50, 0))
        pen.lineTo((450, 0))
        pen.lineTo((450, 750))
        pen.lineTo((50, 750))
        pen.closePath()
        return pen.glyph()

    # Create all pixels as purple base layer
    all_pixels = white_pixels + light_blue_pixels + purple_pixels

    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_empty_base(),
        "blinka.purple": create_snapped_layer_glyph(all_pixels, "purple_base"),
        "blinka.lightblue": create_snapped_layer_glyph(light_blue_pixels, "blue_overlay"),
        "blinka.white": create_snapped_layer_glyph(white_pixels, "white_overlay")
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {0x20: "space", 0xE000: "blinka"}
    fb.setupCharacterMap(cmap)

    # Metrics calculation
    if all_pixels:
        min_x = min(x for x, y in all_pixels)
        max_x = max(x for x, y in all_pixels)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100 + 12
    else:
        glyph_width = original_width * scale_factor + 100

    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple": (glyph_width, 50),
        "blinka.lightblue": (glyph_width, 50),
        "blinka.white": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Snapped Coordinate Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoSnappedCoordinateBlinka-1.0",
        "fullName": "FreeMono Snapped Coordinate Blinka Regular",
        "psName": "FreeMonoSnappedCoordinateBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    font = fb.font

    # COLR/CPAL tables
    try:
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)
        light_blue_color = (166/255.0, 202/255.0, 240/255.0, 1.0)
        palette = [purple_color, white_color, light_blue_color]

        colr_data = {
            "blinka": [
                ("blinka.purple", 0),
                ("blinka.lightblue", 2),
                ("blinka.white", 1)
            ]
        }

        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with coordinate snapping and +12 offset correction")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save font
    output_path = "FreeMono-SnappedCoordinate-Blinka.ttf"
    font.save(output_path)

    print(f"\nSnapped coordinate font created: {output_path}")
    if success:
        print("* Coordinates snapped to integer boundaries")
        print("* Applied +12 unit correction for alignment")
        print("* Test if this fixes the persistent 'off by 3' issue")

    return True

if __name__ == "__main__":
    create_snapped_coordinate_blinka()