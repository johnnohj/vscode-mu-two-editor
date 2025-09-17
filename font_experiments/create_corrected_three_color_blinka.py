#!/usr/bin/env python3
"""
Create corrected three-color Blinka font with X-coordinate offset fix
Apply +12 unit correction to fix the "3 spots too early" issue
"""

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.colorLib.builder import buildCOLR, buildCPAL
from PIL import Image
import os

def create_corrected_three_color_blinka():
    """Create three-color Blinka with corrected X-coordinate offset"""

    print("Creating corrected three-color Blinka font from BMP...")
    print("Applying +12 unit X-coordinate correction to fix '3 spots too early' issue")

    bmp_path = "assets/blinka.bmp"
    if not os.path.exists(bmp_path):
        print(f"BMP file not found: {bmp_path}")
        return False

    # Load and analyze the BMP (same as working 3-color)
    img = Image.open(bmp_path)
    img = img.convert('RGBA')
    original_width, original_height = img.size

    print(f"Original BMP: {original_width}x{original_height}")

    # Get background color (black)
    bg_color = img.getpixel((0, 0))[:3]
    print(f"Background color: RGB{bg_color}")

    # Define our three specific colors (same as working 3-color)
    white_rgb = (255, 255, 255)
    light_blue_rgb = (166, 202, 240)

    # Separate pixels by our three colors (same logic as working version)
    white_pixels = []
    light_blue_pixels = []
    purple_pixels = []

    for y in range(original_height):
        for x in range(original_width):
            pixel = img.getpixel((x, y))
            rgb = pixel[:3]

            if rgb == bg_color:  # Skip black background
                continue
            elif rgb == white_rgb:
                white_pixels.append((x, y))
            elif rgb == light_blue_rgb:
                light_blue_pixels.append((x, y))
            else:
                # Everything else becomes purple
                purple_pixels.append((x, y))

    print(f"\nPixel analysis (same as working 3-color):")
    print(f"White pixels: {len(white_pixels)}")
    print(f"Light blue pixels: {len(light_blue_pixels)}")
    print(f"Purple pixels (all others): {len(purple_pixels)}")

    # Scale factor and CORRECTED base offset
    scale_factor = 4
    corrected_base_offset = 50 + 12  # Original 50 + 12 unit correction

    print(f"\nCoordinate correction:")
    print(f"Original base X offset: 50")
    print(f"Corrected base X offset: {corrected_base_offset}")
    print(f"Correction amount: +12 units (3 pixels * 4 scale)")

    # Create base font
    fb = FontBuilder(1000, isTTF=True)
    glyph_order = [".notdef", "space", "blinka", "blinka.purple", "blinka.white", "blinka.lightblue"]
    fb.setupGlyphOrder(glyph_order)

    def create_corrected_color_layer_glyph(pixel_positions, color_name):
        """Create a layer glyph with CORRECTED X-coordinates"""
        pen = TTGlyphPen(None)

        if not pixel_positions:
            return pen.glyph()  # Empty glyph if no pixels

        print(f"Creating {color_name} layer with CORRECTED coordinates:")

        for i, (x, y) in enumerate(pixel_positions):
            # Same Y-axis flip calculation
            flipped_y = (original_height - 1 - y)

            # CORRECTED X-coordinate calculation
            left = x * scale_factor + corrected_base_offset
            right = left + scale_factor
            bottom = flipped_y * scale_factor + 100  # Y offset unchanged
            top = bottom + scale_factor

            # Debug output for the first few pixels
            if i < 2:
                original_left = x * scale_factor + 50
                correction = left - original_left
                print(f"  Pixel {i}: BMP({x},{y})")
                print(f"    Original: Font X={original_left}-{original_left + scale_factor}")
                print(f"    Corrected: Font X={left}-{right} (shift: +{correction})")

            # Add rectangle with corrected coordinates
            pen.moveTo((left, bottom))
            pen.lineTo((right, bottom))
            pen.lineTo((right, top))
            pen.lineTo((left, top))
            pen.closePath()

        return pen.glyph()

    def create_corrected_base_outline_glyph():
        """Create base outline with CORRECTED coordinates"""
        pen = TTGlyphPen(None)

        all_visible = white_pixels + light_blue_pixels + purple_pixels
        if not all_visible:
            # Fallback rectangle with corrected offset
            pen.moveTo((corrected_base_offset, 100))
            pen.lineTo((corrected_base_offset + original_width * scale_factor, 100))
            pen.lineTo((corrected_base_offset + original_width * scale_factor, 100 + original_height * scale_factor))
            pen.lineTo((corrected_base_offset, 100 + original_height * scale_factor))
            pen.closePath()
            return pen.glyph()

        # Find actual bounds (with Y-flip) - same calculation
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        min_y = min(original_height - 1 - y for x, y in all_visible)
        max_y = max(original_height - 1 - y for x, y in all_visible)

        # Scale to font coordinates with CORRECTED base offset
        left = min_x * scale_factor + corrected_base_offset
        right = (max_x + 1) * scale_factor + corrected_base_offset
        bottom = min_y * scale_factor + 100
        top = (max_y + 1) * scale_factor + 100

        print(f"\nBase outline with corrected coordinates:")
        print(f"  Bounds: X={left}-{right}, Y={bottom}-{top}")

        # Create tight bounding rectangle
        pen.moveTo((left, bottom))
        pen.lineTo((right, bottom))
        pen.lineTo((right, top))
        pen.lineTo((left, top))
        pen.closePath()

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

    # Setup glyphs with corrected coordinates
    glyphs = {
        ".notdef": create_notdef_glyph(),
        "space": create_space_glyph(),
        "blinka": create_corrected_base_outline_glyph(),
        "blinka.purple": create_corrected_color_layer_glyph(purple_pixels, "purple"),
        "blinka.white": create_corrected_color_layer_glyph(white_pixels, "white"),
        "blinka.lightblue": create_corrected_color_layer_glyph(light_blue_pixels, "lightblue")
    }

    fb.setupGlyf(glyphs)

    # Character mapping
    cmap = {
        0x20: "space",
        0xE000: "blinka"
    }
    fb.setupCharacterMap(cmap)

    # Calculate proper metrics with corrected coordinates
    all_visible = white_pixels + light_blue_pixels + purple_pixels
    if all_visible:
        min_x = min(x for x, y in all_visible)
        max_x = max(x for x, y in all_visible)
        glyph_width = (max_x - min_x + 2) * scale_factor + 100 + 12  # Add correction to width
    else:
        glyph_width = original_width * scale_factor + 100 + 12

    # Metrics
    metrics = {
        ".notdef": (500, 50),
        "space": (600, 0),
        "blinka": (glyph_width, 50),
        "blinka.purple": (glyph_width, 50),
        "blinka.white": (glyph_width, 50),
        "blinka.lightblue": (glyph_width, 50)
    }

    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader()

    # Font info
    fb.setupNameTable({
        "familyName": "FreeMono Corrected Three Color Blinka",
        "styleName": "Regular",
        "uniqueFontIdentifier": "FreeMonoCorrectedThreeColorBlinka-1.0",
        "fullName": "FreeMono Corrected Three Color Blinka Regular",
        "psName": "FreeMonoCorrectedThreeColorBlinka-Regular",
        "version": "1.0"
    })

    fb.setupOS2()
    fb.setupPost()

    # Create the font
    font = fb.font

    # Add COLR/CPAL tables (same as working version)
    try:
        # Define our color palette (same as working version)
        purple_color = (128/255.0, 32/255.0, 192/255.0, 1.0)
        white_color = (255/255.0, 255/255.0, 255/255.0, 1.0)
        light_blue_color = (166/255.0, 202/255.0, 240/255.0, 1.0)
        palette = [purple_color, white_color, light_blue_color]

        # COLR data - same layer order as working version
        colr_data = {
            "blinka": [
                ("blinka.purple", 0),    # purple layer, palette index 0
                ("blinka.lightblue", 2), # light blue layer, palette index 2
                ("blinka.white", 1)      # white layer, palette index 1 (on top)
            ]
        }

        # Build COLR and CPAL tables
        colr_table = buildCOLR(colr_data)
        cpal_table = buildCPAL([palette])

        # Add to font
        font["COLR"] = colr_table
        font["CPAL"] = cpal_table

        print(f"\nAdded COLR/CPAL with corrected X-coordinates:")
        print(f"  Palette[0]: Purple RGB(128, 32, 192)")
        print(f"  Palette[1]: White RGB(255, 255, 255)")
        print(f"  Palette[2]: Light Blue RGB(166, 202, 240)")
        success = True

    except Exception as e:
        print(f"Could not add COLR/CPAL tables: {e}")
        success = False

    # Save the font
    output_path = "FreeMono-CorrectedThreeColor-Blinka.ttf"
    font.save(output_path)

    print(f"\nCorrected three-color Blinka font created: {output_path}")
    print(f"Blinka character: \\uE000")

    if success:
        print("* Three-color COLR/CPAL with +12 unit X-coordinate correction")
        print("* Should fix the '3 spots too early' alignment issue")
        print("* Light blue pixels should now align with correct spaces")
    else:
        print("* Created outline-only version")

    return True

if __name__ == "__main__":
    create_corrected_three_color_blinka()